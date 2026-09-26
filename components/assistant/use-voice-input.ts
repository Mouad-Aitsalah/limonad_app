"use client";

import * as React from "react";

/**
 * Voice input of the AI Assistant (phase 1): record with MediaRecorder, send the
 * audio to POST /api/assistant/transcribe, give the text back. It NEVER calls
 * the agent (/api/ai/chat) and never submits anything: the caller puts the text
 * in the input and the user presses "Envoyer" himself.
 *
 * The recorder logic lives in createVoiceRecorder() (framework-free, with its
 * browser dependencies injectable) so it can be tested with a fake
 * MediaRecorder / getUserMedia / fetch. useVoiceInput() is the thin React
 * wrapper. The microphone is released as soon as the recording ends and when
 * the component unmounts.
 */

export const TRANSCRIBE_ENDPOINT = "/api/assistant/transcribe";
/** Same limit as the server. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
/** A voice question never needs more: stop by itself instead of growing forever. */
export const MAX_RECORDING_MS = 120_000;

/** First supported one wins; the browser default is used when none is. */
export const CANDIDATE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export const VOICE_MESSAGES = {
  notSupported: "Votre navigateur ne prend pas en charge l'enregistrement vocal.",
  permissionDenied: "Autorisation du microphone refusée.",
  microphoneUnavailable: "Microphone indisponible.",
  recordingFailed: "Une erreur est survenue pendant l'enregistrement.",
  empty: "Aucun son détecté.",
  tooLarge: "Enregistrement trop volumineux (5 Mo maximum).",
  transcriptionFailed: "Impossible de transcrire l'audio. Réessayez.",
  server: "Une erreur est survenue pendant la transcription.",
} as const;

/** Empty input: the transcription. Otherwise: the existing text, a space, the transcription. */
export function appendTranscript(current: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return current;
  if (!current.trim()) return text;
  return `${current.replace(/\s+$/, "")} ${text}`;
}

type RecorderLike = {
  state: string;
  mimeType: string;
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
};

type RecorderConstructor = {
  new (stream: MediaStream, options?: { mimeType?: string }): RecorderLike;
  isTypeSupported?: (type: string) => boolean;
};

export type VoiceEnvironment = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: RecorderConstructor;
  fetchFn?: typeof fetch;
};

export type VoiceState = "idle" | "recording" | "transcribing";

export type VoiceRecorderCallbacks = {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (text: string) => void;
  /** A message to show, or null to clear the previous one. */
  onError: (message: string | null) => void;
};

function browserEnvironment(): VoiceEnvironment {
  if (typeof navigator === "undefined") return {};
  const devices = navigator.mediaDevices;
  return {
    getUserMedia: devices?.getUserMedia ? (constraints) => devices.getUserMedia(constraints) : undefined,
    MediaRecorder: (globalThis as { MediaRecorder?: RecorderConstructor }).MediaRecorder,
    fetchFn: (input, init) => fetch(input, init),
  };
}

export function createVoiceRecorder(callbacks: VoiceRecorderCallbacks, environment?: VoiceEnvironment) {
  const env = environment ?? browserEnvironment();

  let state: VoiceState = "idle";
  let starting = false;
  let disposed = false;
  let stream: MediaStream | null = null;
  let recorder: RecorderLike | null = null;
  let chunks: Blob[] = [];
  let mimeType = "";
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  function setState(next: VoiceState) {
    state = next;
    if (!disposed) callbacks.onStateChange(next);
  }

  function fail(message: string) {
    if (!disposed) callbacks.onError(message);
    setState("idle");
  }

  /** Releases the microphone: no track is left running. */
  function releaseStream() {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function isSupported(): boolean {
    return Boolean(env.getUserMedia && env.MediaRecorder);
  }

  function pickMimeType(): string {
    const Recorder = env.MediaRecorder;
    if (!Recorder?.isTypeSupported) return "";
    return CANDIDATE_MIME_TYPES.find((type) => Recorder.isTypeSupported?.(type)) ?? "";
  }

  async function transcribe(blob: Blob) {
    if (!env.fetchFn) return fail(VOICE_MESSAGES.server);
    abortController = new AbortController();
    try {
      const body = new FormData();
      const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      body.append("audio", blob, `voice.${extension}`);
      const response = await env.fetchFn(TRANSCRIBE_ENDPOINT, { method: "POST", body, signal: abortController.signal });
      const payload = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (disposed) return;
      if (!response.ok) {
        return fail(payload.error ?? (response.status >= 500 ? VOICE_MESSAGES.server : VOICE_MESSAGES.transcriptionFailed));
      }
      const text = payload.text?.trim() ?? "";
      if (!text) return fail(VOICE_MESSAGES.empty);
      callbacks.onTranscript(text);
      setState("idle");
    } catch (error) {
      if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
      fail(VOICE_MESSAGES.transcriptionFailed);
    } finally {
      abortController = null;
    }
  }

  function handleRecordingStopped() {
    const finishedChunks = chunks;
    const type = recorder?.mimeType || mimeType || "audio/webm";
    chunks = [];
    recorder = null;
    releaseStream();
    if (disposed) return;
    const blob = new Blob(finishedChunks, { type });
    if (blob.size === 0) return fail(VOICE_MESSAGES.empty);
    if (blob.size > MAX_AUDIO_BYTES) return fail(VOICE_MESSAGES.tooLarge);
    void transcribe(blob);
  }

  async function start() {
    if (state !== "idle" || starting) return; // one recording at a time
    callbacks.onError(null);
    if (!isSupported()) return callbacks.onError(VOICE_MESSAGES.notSupported);

    starting = true;
    try {
      let acquired: MediaStream;
      try {
        acquired = await env.getUserMedia!({ audio: true });
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        return callbacks.onError(
          name === "NotAllowedError" || name === "SecurityError"
            ? VOICE_MESSAGES.permissionDenied
            : VOICE_MESSAGES.microphoneUnavailable,
        );
      }
      if (disposed) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;

      try {
        mimeType = pickMimeType();
        const Recorder = env.MediaRecorder!;
        recorder = new Recorder(acquired, mimeType ? { mimeType } : undefined);
        chunks = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = handleRecordingStopped;
        recorder.onerror = () => {
          recorder = null;
          chunks = [];
          releaseStream();
          fail(VOICE_MESSAGES.recordingFailed);
        };
        recorder.start();
      } catch {
        recorder = null;
        releaseStream();
        return callbacks.onError(VOICE_MESSAGES.recordingFailed);
      }

      setState("recording");
      stopTimer = setTimeout(() => stop(), MAX_RECORDING_MS);
    } finally {
      starting = false;
    }
  }

  function stop() {
    if (state !== "recording" || !recorder) return;
    // The next state is set right away so the UI never shows a gap; onstop then
    // releases the microphone and sends the audio.
    setState("transcribing");
    try {
      recorder.stop();
    } catch {
      recorder = null;
      releaseStream();
      fail(VOICE_MESSAGES.recordingFailed);
    }
  }

  /** Unmount: nothing is sent, the microphone is released, a pending request is cancelled. */
  function dispose() {
    disposed = true;
    abortController?.abort();
    if (recorder) {
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // already stopped
      }
      recorder = null;
    }
    chunks = [];
    releaseStream();
  }

  return { start, stop, dispose, isSupported };
}

export function useVoiceInput(options: { onTranscript: (text: string) => void }) {
  const [isRecording, setIsRecording] = React.useState(false);
  const [isTranscribing, setIsTranscribing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const onTranscriptRef = React.useRef(options.onTranscript);
  React.useEffect(() => {
    onTranscriptRef.current = options.onTranscript;
  }, [options.onTranscript]);

  const controllerRef = React.useRef<ReturnType<typeof createVoiceRecorder> | null>(null);
  React.useEffect(() => {
    const controller = createVoiceRecorder({
      onStateChange: (state) => {
        setIsRecording(state === "recording");
        setIsTranscribing(state === "transcribing");
      },
      onTranscript: (text) => onTranscriptRef.current(text),
      onError: setError,
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const startRecording = React.useCallback(() => controllerRef.current?.start() ?? Promise.resolve(), []);
  const stopRecording = React.useCallback(() => controllerRef.current?.stop(), []);
  const clearError = React.useCallback(() => setError(null), []);

  return { isRecording, isTranscribing, startRecording, stopRecording, error, clearError };
}
