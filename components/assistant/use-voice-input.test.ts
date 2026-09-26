import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendTranscript,
  createVoiceRecorder,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  TRANSCRIBE_ENDPOINT,
  VOICE_MESSAGES,
  type VoiceEnvironment,
  type VoiceState,
} from "./use-voice-input";

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks = [new FakeTrack(), new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

/** A MediaRecorder stand-in: start() queues a data chunk, stop() fires ondataavailable then onstop. */
function makeRecorderClass(options: { supported: string[]; chunkBytes?: number; failOnStart?: boolean }) {
  const instances: FakeRecorder[] = [];
  class FakeRecorder {
    static isTypeSupported = (type: string) => options.supported.includes(type);
    state = "inactive";
    mimeType: string;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    constructor(
      public stream: unknown,
      public opts?: { mimeType?: string },
    ) {
      this.mimeType = opts?.mimeType ?? "";
      instances.push(this);
    }
    start() {
      if (options.failOnStart) throw new Error("start failed");
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      const bytes = options.chunkBytes ?? 1000;
      if (bytes > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: this.mimeType || "audio/webm" }) });
      this.onstop?.();
    }
  }
  return { FakeRecorder, instances };
}

function harness(config: {
  supported?: string[];
  chunkBytes?: number;
  getUserMedia?: () => Promise<FakeStream>;
  noRecorder?: boolean;
  failOnStart?: boolean;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const stream = new FakeStream();
  const { FakeRecorder, instances } = makeRecorderClass({
    supported: config.supported ?? ["audio/webm;codecs=opus", "audio/webm"],
    chunkBytes: config.chunkBytes,
    failOnStart: config.failOnStart,
  });
  const fetchCalls: Array<{ url: string; body: FormData | null; method?: string }> = [];
  const events: string[] = [];
  const states: VoiceState[] = [];
  const transcripts: string[] = [];
  const errors: Array<string | null> = [];
  const environment: VoiceEnvironment = {
    getUserMedia: (config.getUserMedia ?? (async () => stream)) as unknown as VoiceEnvironment["getUserMedia"],
    MediaRecorder: config.noRecorder ? undefined : (FakeRecorder as unknown as VoiceEnvironment["MediaRecorder"]),
    fetchFn: (async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, body: (init?.body as FormData) ?? null, method: init?.method });
      events.push(`fetch:${url}`);
      return config.fetchImpl
        ? config.fetchImpl(url, init)
        : Response.json({ text: "ch7al 3ndi men Coca 1L f stock ?" });
    }) as typeof fetch,
  };
  const controller = createVoiceRecorder(
    {
      onStateChange: (state) => states.push(state),
      onTranscript: (text) => transcripts.push(text),
      onError: (message) => errors.push(message),
    },
    environment,
  );
  return { controller, stream, instances, fetchCalls, states, transcripts, errors, events };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("recording flow: recording -> transcribing -> idle, the text is handed over, ONLY /api/assistant/transcribe is called", async () => {
  const h = harness({});
  await h.controller.start();
  assert.deepEqual(h.states, ["recording"]);
  h.controller.stop();
  assert.deepEqual(h.states, ["recording", "transcribing"]);
  await settle();
  assert.deepEqual(h.states, ["recording", "transcribing", "idle"]);
  assert.deepEqual(h.transcripts, ["ch7al 3ndi men Coca 1L f stock ?"]);
  // never the agent: no automatic submission of the message
  assert.deepEqual(h.fetchCalls.map((c) => c.url), [TRANSCRIBE_ENDPOINT]);
  assert.equal(h.fetchCalls[0].method, "POST");
  const file = h.fetchCalls[0].body!.get("audio") as File;
  assert.ok(file instanceof Blob && file.size === 1000);
  assert.equal(file.type, "audio/webm;codecs=opus");
});

test("the microphone is released as soon as the recording stops (no track left running)", async () => {
  const h = harness({});
  await h.controller.start();
  assert.equal(h.stream.tracks.every((t) => t.stopped), false, "live while recording");
  h.controller.stop();
  assert.equal(h.stream.tracks.every((t) => t.stopped), true, "released right after stop, before the upload ends");
});

test("format: the first supported MIME type is used, the browser default otherwise", async () => {
  const opus = harness({ supported: ["audio/webm;codecs=opus", "audio/mp4"] });
  await opus.controller.start();
  assert.equal(opus.instances[0].opts?.mimeType, "audio/webm;codecs=opus");
  opus.controller.dispose();
  const safari = harness({ supported: ["audio/mp4"] });
  await safari.controller.start();
  assert.equal(safari.instances[0].opts?.mimeType, "audio/mp4");
  safari.controller.dispose();
  const none = harness({ supported: [] });
  await none.controller.start();
  assert.equal(none.instances[0].opts, undefined);
  none.controller.dispose();
});

test("6. microphone denied: clear message, nothing recorded, nothing sent", async () => {
  const h = harness({
    getUserMedia: async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    },
  });
  await h.controller.start();
  assert.equal(h.errors.at(-1), VOICE_MESSAGES.permissionDenied);
  assert.equal(VOICE_MESSAGES.permissionDenied, "Autorisation du microphone refusée.");
  assert.deepEqual(h.states, []);
  assert.equal(h.instances.length, 0);
  assert.equal(h.fetchCalls.length, 0);
});

test("no microphone: unavailable message", async () => {
  const h = harness({
    getUserMedia: async () => {
      throw Object.assign(new Error("none"), { name: "NotFoundError" });
    },
  });
  await h.controller.start();
  assert.equal(h.errors.at(-1), VOICE_MESSAGES.microphoneUnavailable);
});

test("10. browser without MediaRecorder: clear message, nothing happens", async () => {
  const h = harness({ noRecorder: true });
  assert.equal(h.controller.isSupported(), false);
  await h.controller.start();
  assert.equal(h.errors.at(-1), "Votre navigateur ne prend pas en charge l'enregistrement vocal.");
  assert.deepEqual(h.states, []);
});

test("empty recording: 'Aucun son détecté.', nothing is uploaded, back to idle", async () => {
  const h = harness({ chunkBytes: 0 });
  await h.controller.start();
  h.controller.stop();
  await settle();
  assert.equal(h.errors.at(-1), "Aucun son détecté.");
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.states.at(-1), "idle");
  assert.equal(h.stream.tracks.every((t) => t.stopped), true);
});

test("recording over 5 MB is refused locally", async () => {
  const h = harness({ chunkBytes: MAX_AUDIO_BYTES + 1 });
  await h.controller.start();
  h.controller.stop();
  await settle();
  assert.equal(h.errors.at(-1), VOICE_MESSAGES.tooLarge);
  assert.equal(h.fetchCalls.length, 0);
});

test("transcription errors: the server message is shown, generic messages otherwise, and the controller is reusable", async () => {
  let mode: "error" | "ok" = "error";
  const h = harness({
    fetchImpl: async () =>
      mode === "error" ? Response.json({ error: "Format audio non supporté." }, { status: 415 }) : Response.json({ text: "Coca" }),
  });
  await h.controller.start();
  h.controller.stop();
  await settle();
  assert.equal(h.errors.at(-1), "Format audio non supporté.");
  assert.equal(h.states.at(-1), "idle");
  assert.deepEqual(h.transcripts, []);

  mode = "ok";
  await h.controller.start();
  h.controller.stop();
  await settle();
  assert.deepEqual(h.transcripts, ["Coca"]);

  const down = harness({ fetchImpl: async () => Promise.reject(new TypeError("Failed to fetch")) });
  await down.controller.start();
  down.controller.stop();
  await settle();
  assert.equal(down.errors.at(-1), VOICE_MESSAGES.transcriptionFailed);
  const crash = harness({ fetchImpl: async () => new Response("<html>", { status: 500 }) });
  await crash.controller.start();
  crash.controller.stop();
  await settle();
  assert.equal(crash.errors.at(-1), VOICE_MESSAGES.server);
});

test("one recording at a time: a second start while recording or transcribing is ignored", async () => {
  const h = harness({});
  await Promise.all([h.controller.start(), h.controller.start()]);
  assert.equal(h.instances.length, 1);
  await h.controller.start();
  assert.equal(h.instances.length, 1);
  h.controller.stop();
  await h.controller.start(); // transcribing: refused
  assert.equal(h.instances.length, 1);
  await settle();
});

test("unmount while recording: the microphone is released and nothing is sent", async () => {
  const h = harness({});
  await h.controller.start();
  h.controller.dispose();
  await settle();
  assert.equal(h.stream.tracks.every((t) => t.stopped), true);
  assert.equal(h.fetchCalls.length, 0);
  assert.deepEqual(h.transcripts, []);
});

test("unmount during the upload: no transcript is delivered afterwards", async () => {
  let release: (response: Response) => void = () => undefined;
  const h = harness({ fetchImpl: () => new Promise<Response>((resolve) => (release = resolve)) });
  await h.controller.start();
  h.controller.stop();
  await settle();
  h.controller.dispose();
  release(Response.json({ text: "trop tard" }));
  await settle();
  assert.deepEqual(h.transcripts, []);
});

test("a permission granted after unmount does not leave the microphone open", async () => {
  const stream = new FakeStream();
  let grant: (s: FakeStream) => void = () => undefined;
  const h = harness({ getUserMedia: () => new Promise<FakeStream>((resolve) => (grant = resolve)) });
  const started = h.controller.start();
  h.controller.dispose();
  grant(stream);
  await started;
  assert.equal(stream.tracks.every((t) => t.stopped), true);
  assert.equal(h.instances.length, 0);
});

test("recorder start failure: message, microphone released", async () => {
  const h = harness({ failOnStart: true });
  await h.controller.start();
  assert.equal(h.errors.at(-1), VOICE_MESSAGES.recordingFailed);
  assert.equal(h.stream.tracks.every((t) => t.stopped), true);
  assert.deepEqual(h.states, []);
});

test("long recordings stop by themselves", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness({});
  await h.controller.start();
  t.mock.timers.tick(MAX_RECORDING_MS + 1);
  assert.equal(h.states.includes("transcribing"), true);
  assert.equal(h.stream.tracks.every((track) => track.stopped), true);
  t.mock.timers.reset();
});

// ---------------------------------------------------------------------------
// What the chat does with the transcript
// ---------------------------------------------------------------------------

test("7. empty input: the transcription replaces it", () => {
  assert.equal(appendTranscript("", "ch7al 3ndi men Coca 1L f stock ?"), "ch7al 3ndi men Coca 1L f stock ?");
  assert.equal(appendTranscript("   ", "Coca"), "Coca");
});

test("8. existing text is kept: a space, then the transcription", () => {
  assert.equal(appendTranscript("Regarde mon stock", "et donne moi le nombre de Coca"), "Regarde mon stock et donne moi le nombre de Coca");
  assert.equal(appendTranscript("Donne-moi  ", "stock Coca"), "Donne-moi stock Coca");
  assert.equal(appendTranscript("Donne-moi", "  "), "Donne-moi");
});

test("Arabic, accents and digits of the transcription are kept as they are", () => {
  assert.equal(appendTranscript("", "chhal 3ndi 1/2L هوائي f stock 3lach ?"), "chhal 3ndi 1/2L هوائي f stock 3lach ?");
});

test("9. nothing is submitted automatically: the hook only ever talks to the transcription endpoint", async () => {
  const h = harness({});
  let message = "Donne-moi";
  const submitted: string[] = [];
  h.controller.start().then(() => undefined);
  await settle();
  h.controller.stop();
  await settle();
  for (const text of h.transcripts) message = appendTranscript(message, text);
  assert.equal(message, "Donne-moi ch7al 3ndi men Coca 1L f stock ?");
  assert.deepEqual(submitted, []);
  assert.deepEqual(h.fetchCalls.map((c) => c.url), ["/api/assistant/transcribe"]);
  assert.equal(h.fetchCalls.some((c) => c.url.includes("/api/ai/chat")), false);
});
