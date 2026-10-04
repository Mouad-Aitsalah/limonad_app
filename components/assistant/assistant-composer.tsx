"use client";

import * as React from "react";
import { LoaderCircle, Mic, Send, Square } from "lucide-react";

import { appendTranscript, useVoiceInput } from "@/components/assistant/use-voice-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type AssistantComposerProps = {
  /** Sends the question; returns false when it was not accepted (the text is then kept). */
  onSend: (text: string) => boolean;
  isLoading: boolean;
  /** Focus the field when mounted (floating panel). */
  autoFocus?: boolean;
  className?: string;
};

/**
 * Message field of the assistant: Enter sends, Shift+Enter adds a line, the
 * microphone transcribes INTO the field (never sends by itself). Shared by the
 * full page and the floating panel.
 */
export function AssistantComposer({ onSend, isLoading, autoFocus = false, className }: AssistantComposerProps) {
  const [message, setMessage] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  // Voice input: the transcription goes INTO the input (existing text kept) and is
  // never sent - the user reads it, edits it if needed and presses "Envoyer".
  const voice = useVoiceInput({
    onTranscript: (text) => setMessage((current) => appendTranscript(current, text)),
  });
  const voiceBusy = voice.isRecording || voice.isTranscribing;

  React.useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  function submit() {
    if (!message.trim() || isLoading || voiceBusy) return;
    if (onSend(message)) setMessage("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {voice.error ? (
        <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {voice.error}
        </p>
      ) : null}

      {voiceBusy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          {voice.isRecording ? (
            <>
              <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
              Enregistrement…
            </>
          ) : (
            <>
              <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-emerald-600" />
              Transcription…
            </>
          )}
        </p>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || voice.isTranscribing}
          placeholder="Écrivez votre question…"
          aria-label="Message pour l’assistant IA"
          className="max-h-32 min-h-12 resize-none"
        />
        <Button
          type="button"
          size="icon"
          variant={voice.isRecording ? "destructive" : "outline"}
          disabled={isLoading || voice.isTranscribing}
          onClick={() => (voice.isRecording ? voice.stopRecording() : void voice.startRecording())}
          aria-label={
            voice.isRecording
              ? "Arrêter l’enregistrement"
              : voice.isTranscribing
                ? "Transcription en cours"
                : "Enregistrer un message vocal"
          }
          aria-pressed={voice.isRecording}
          className={cn("h-12 w-12 shrink-0 rounded-xl", voice.isRecording && "animate-pulse")}
        >
          {voice.isTranscribing ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : voice.isRecording ? (
            <Square aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Mic aria-hidden="true" className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          disabled={!message.trim() || isLoading || voiceBusy}
          onClick={submit}
          aria-label="Envoyer le message"
          className="h-12 w-12 shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
