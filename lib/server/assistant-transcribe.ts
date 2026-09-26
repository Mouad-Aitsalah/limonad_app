import { baseMimeType, SpeechToTextError, type TranscribeAudioInput } from "@/lib/server/speech-to-text";

/**
 * POST /api/assistant/transcribe - the request logic, with its collaborators
 * injected so it can be tested without Next, Prisma or Gemini. The route file
 * wires the real ones (same protection as /api/ai/chat: CSRF origin check and
 * an admin session of the organization).
 *
 * The audio is read into memory, handed to the transcription service and
 * dropped: never written to disk, never stored in the database.
 */

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB
/** Multipart framing adds a little to the file itself. */
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 256 * 1024;

/** What MediaRecorder produces in the browsers (webm/ogg: Chrome, Edge, Firefox, Android; mp4: Safari). */
export const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "video/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/flac",
]);

export type TranscribeDeps = {
  /** Returns a ready-made rejection Response, or null when the origin is trusted. */
  rejectUntrustedOrigin: (request: Request) => Response | null;
  /** Throws (an error carrying `status`) when there is no admin session. */
  requireAdmin: () => Promise<unknown>;
  transcribe: (input: TranscribeAudioInput) => Promise<string>;
  /** Turns an auth error into { message, status }, or null when it is not one. */
  describeAuthError: (error: unknown) => { message: string; status: number } | null;
};

const json = (body: unknown, status: number) => Response.json(body, { status });

export async function handleTranscribeRequest(request: Request, deps: TranscribeDeps): Promise<Response> {
  const csrfRejection = deps.rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  try {
    await deps.requireAdmin();

    // Refuse an oversized body before buffering it.
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return json({ error: "Enregistrement trop volumineux (5 Mo maximum)." }, 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Requête invalide : un fichier audio est attendu." }, 400);
    }

    const file = form.get("audio");
    if (!(file instanceof Blob)) return json({ error: "Aucun fichier audio reçu." }, 400);
    if (file.size === 0) return json({ error: "Aucun son détecté." }, 400);
    if (file.size > MAX_AUDIO_BYTES) return json({ error: "Enregistrement trop volumineux (5 Mo maximum)." }, 413);

    const mimeType = baseMimeType(file.type);
    if (!ALLOWED_AUDIO_TYPES.has(mimeType)) return json({ error: "Format audio non supporté." }, 415);

    const text = await deps.transcribe({ audio: new Uint8Array(await file.arrayBuffer()), mimeType: file.type });
    return json({ text }, 200);
  } catch (error) {
    const auth = deps.describeAuthError(error);
    if (auth) return json({ error: auth.message }, auth.status);
    if (error instanceof SpeechToTextError) {
      if (error.code === "EMPTY") return json({ error: "Aucun son détecté." }, 422);
      if (error.code === "NOT_CONFIGURED") return json({ error: "La transcription n'est pas configurée sur le serveur." }, 500);
      return json({ error: "Impossible de transcrire l'audio. Réessayez." }, 502);
    }
    console.error("Erreur API transcription :", error);
    return json({ error: "Une erreur est survenue pendant la transcription." }, 500);
  }
}
