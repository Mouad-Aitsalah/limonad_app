import { GoogleGenAI } from "@google/genai";

/**
 * Speech-to-text for the AI Assistant's voice input (phase 1).
 *
 * The ONLY place that calls Gemini for transcription: to use another provider
 * later, replace transcribeAudio() and nothing else (the route, the hook and
 * the chat only know "audio in, text out"). It reuses the project's existing
 * Gemini setup (@google/genai, GEMINI_API_KEY, the same model as the chat,
 * overridable with GEMINI_TRANSCRIBE_MODEL) - no second AI architecture.
 *
 * The audio only ever lives in memory for the duration of the call: it is
 * base64-encoded into the request and dropped. Nothing is written to disk or
 * to the database. The key is read here, on the server, and never leaves it.
 * (Deliberately no `server-only` import so the module can be unit-tested with
 * a fake client; it holds no secret at import time.)
 */

export const DEFAULT_TRANSCRIPTION_MODEL = "gemini-3.5-flash-lite";

/** What the model is told: transcribe, never translate, answer or reformulate. */
export const TRANSCRIPTION_PROMPT = [
  "Tu es un moteur de transcription vocale (speech-to-text) pour l'assistant d'un logiciel de gestion de stock et de ventes utilisé au Maroc.",
  "Transcris fidèlement, mot pour mot, ce que la personne dit dans l'audio.",
  "Règles strictes :",
  "- Ne traduis JAMAIS : la darija marocaine reste de la darija, le français reste du français, l'arabe reste de l'arabe.",
  "- Écris la darija en alphabet latin (arabizi) comme elle est dite, en gardant les chiffres utilisés dans l'écriture de la darija : ch7al, 3lach, 3ndi, 7aja, 9der, 3afak, 9a3, lyouma, etc. N'écris pas la darija en lettres arabes sauf si la personne parle clairement en arabe standard.",
  "- Ne reformule pas, ne corrige pas la grammaire, ne résume pas.",
  "- Ne réponds PAS à la question posée dans l'audio : tu ne fais que la transcrire.",
  "- Conserve tels quels les noms de produits, les marques, les quantités, les unités (1L, 1/2 litre, kg...) et les nombres tels qu'ils sont prononcés.",
  "- N'ajoute aucun Markdown, aucun titre, aucun commentaire, aucune balise, aucun guillemet autour du texte.",
  "- Si l'audio ne contient aucune parole audible, retourne une réponse vide.",
  "Retourne UNIQUEMENT la transcription.",
].join("\n");

export type SpeechToTextErrorCode = "NOT_CONFIGURED" | "EMPTY" | "PROVIDER";

export class SpeechToTextError extends Error {
  constructor(
    message: string,
    readonly code: SpeechToTextErrorCode,
  ) {
    super(message);
    this.name = "SpeechToTextError";
  }
}

/** The one method of the Gemini client this file needs (a test injects a fake). */
export type TranscriptionClient = {
  models: {
    generateContent(params: {
      model: string;
      contents: Array<{ role: string; parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> }>;
      config?: { systemInstruction?: string; temperature?: number };
    }): Promise<{ text?: string | undefined }>;
  };
};

export type TranscribeAudioInput = {
  audio: Uint8Array;
  /** MIME type as sent by the browser, possibly with codecs ("audio/webm;codecs=opus"). */
  mimeType: string;
};

/** "audio/webm;codecs=opus" -> "audio/webm". */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Removes what a model sometimes wraps around a transcription (quotes, code fences). */
export function cleanTranscription(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[a-z]*\n?([\s\S]*?)\n?```$/i);
  if (fenced) text = fenced[1].trim();
  const quotes: Array<[string, string]> = [
    ['"', '"'],
    ["“", "”"],
    ["«", "»"],
  ];
  for (const [open, close] of quotes) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, text.length - close.length).trim();
      break;
    }
  }
  return text;
}

export async function transcribeAudio(
  input: TranscribeAudioInput,
  deps: { client?: TranscriptionClient; model?: string } = {},
): Promise<string> {
  let client = deps.client;
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new SpeechToTextError("La clé Gemini n'est pas configurée.", "NOT_CONFIGURED");
    client = new GoogleGenAI({ apiKey }) as unknown as TranscriptionClient;
  }
  const model = deps.model ?? process.env.GEMINI_TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIPTION_MODEL;

  let response: { text?: string | undefined };
  try {
    response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: "Transcris cet audio." },
            { inlineData: { mimeType: baseMimeType(input.mimeType), data: Buffer.from(input.audio).toString("base64") } },
          ],
        },
      ],
      // temperature 0: the most literal output, no creative rewording.
      config: { systemInstruction: TRANSCRIPTION_PROMPT, temperature: 0 },
    });
  } catch (error) {
    console.error("Erreur de transcription Gemini :", error);
    throw new SpeechToTextError("Le service de transcription a échoué.", "PROVIDER");
  }

  const text = cleanTranscription(response.text ?? "");
  if (!text) throw new SpeechToTextError("Aucun son détecté.", "EMPTY");
  return text;
}
