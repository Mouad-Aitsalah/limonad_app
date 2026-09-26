import assert from "node:assert/strict";
import { test } from "node:test";

import { ALLOWED_AUDIO_TYPES, handleTranscribeRequest, MAX_AUDIO_BYTES, type TranscribeDeps } from "./assistant-transcribe";
import {
  baseMimeType,
  cleanTranscription,
  SpeechToTextError,
  transcribeAudio,
  TRANSCRIPTION_PROMPT,
  type TranscriptionClient,
} from "./speech-to-text";

function deps(overrides: Partial<TranscribeDeps> = {}): TranscribeDeps & { calls: Array<{ size: number; mimeType: string }> } {
  const calls: Array<{ size: number; mimeType: string }> = [];
  return {
    calls,
    rejectUntrustedOrigin: () => null,
    requireAdmin: async () => ({ id: "u1" }),
    transcribe: async (input) => {
      calls.push({ size: input.audio.length, mimeType: input.mimeType });
      return "ch7al 3ndi men coca f stock ?";
    },
    describeAuthError: (error) => {
      const e = error as { status?: number; message?: string; auth?: boolean };
      return e?.auth ? { message: e.message ?? "", status: e.status ?? 401 } : null;
    },
    ...overrides,
  };
}

function request(file?: { bytes: number; type: string } | null, headers: Record<string, string> = {}): Request {
  const form = new FormData();
  if (file) form.append("audio", new Blob([new Uint8Array(file.bytes).fill(1)], { type: file.type }), "voice.webm");
  return new Request("http://localhost/api/assistant/transcribe", { method: "POST", body: form, headers });
}

test("1. no file: 400 with a clear error", async () => {
  const d = deps();
  const response = await handleTranscribeRequest(request(null), d);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Aucun fichier audio reçu." });
  assert.equal(d.calls.length, 0);
});

test("a body that is not multipart is refused", async () => {
  const response = await handleTranscribeRequest(
    new Request("http://localhost/api/assistant/transcribe", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
    deps(),
  );
  assert.equal(response.status, 400);
});

test("an empty recording: 400 Aucun son détecté", async () => {
  const response = await handleTranscribeRequest(request({ bytes: 0, type: "audio/webm" }), deps());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Aucun son détecté." });
});

test("2. file over 5 MB: 413 and the service is never called", async () => {
  const d = deps();
  const response = await handleTranscribeRequest(request({ bytes: MAX_AUDIO_BYTES + 1, type: "audio/webm" }), d);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /5 Mo/);
  assert.equal(d.calls.length, 0);
  // a declared oversized body is refused before it is even read
  const declared = await handleTranscribeRequest(request({ bytes: 10, type: "audio/webm" }, { "content-length": String(MAX_AUDIO_BYTES * 3) }), d);
  assert.equal(declared.status, 413);
});

test("3. wrong MIME type: 415", async () => {
  const d = deps();
  for (const type of ["text/plain", "application/pdf", "image/png", ""]) {
    const response = await handleTranscribeRequest(request({ bytes: 100, type }), d);
    assert.equal(response.status, 415, type);
    assert.deepEqual(await response.json(), { error: "Format audio non supporté." });
  }
  assert.equal(d.calls.length, 0);
});

test("4. success: { text }, browser formats (with codecs) accepted, audio only in memory", async () => {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    const d = deps();
    const response = await handleTranscribeRequest(request({ bytes: 2048, type }), d);
    assert.equal(response.status, 200, type);
    assert.deepEqual(await response.json(), { text: "ch7al 3ndi men coca f stock ?" });
    assert.deepEqual(d.calls, [{ size: 2048, mimeType: type }]);
  }
  assert.ok(ALLOWED_AUDIO_TYPES.has("audio/webm") && ALLOWED_AUDIO_TYPES.has("audio/mp4"));
});

test("5. transcription service failure: 502 with a clear message, no provider detail leaked", async () => {
  const response = await handleTranscribeRequest(
    request({ bytes: 100, type: "audio/webm" }),
    deps({
      transcribe: async () => {
        throw new SpeechToTextError("Gemini 500 secret detail", "PROVIDER");
      },
    }),
  );
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(body, { error: "Impossible de transcrire l'audio. Réessayez." });
});

test("no speech: 422; missing key: 500; unexpected error: 500 generic", async () => {
  const run = async (error: Error) =>
    handleTranscribeRequest(request({ bytes: 100, type: "audio/webm" }), deps({ transcribe: async () => Promise.reject(error) }));
  const empty = await run(new SpeechToTextError("x", "EMPTY"));
  assert.equal(empty.status, 422);
  assert.deepEqual(await empty.json(), { error: "Aucun son détecté." });
  const noKey = await run(new SpeechToTextError("x", "NOT_CONFIGURED"));
  assert.equal(noKey.status, 500);
  const boom = await run(new Error("boom"));
  assert.equal(boom.status, 500);
  assert.deepEqual(await boom.json(), { error: "Une erreur est survenue pendant la transcription." });
});

test("same protection as the chat: CSRF rejection and admin session are enforced before anything is read", async () => {
  const d = deps({ rejectUntrustedOrigin: () => new Response("forbidden", { status: 403 }) });
  assert.equal((await handleTranscribeRequest(request({ bytes: 100, type: "audio/webm" }), d)).status, 403);
  assert.equal(d.calls.length, 0);

  const d2 = deps({
    requireAdmin: async () => {
      throw { auth: true, message: "Accès refusé.", status: 403 };
    },
  });
  const denied = await handleTranscribeRequest(request({ bytes: 100, type: "audio/webm" }), d2);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "Accès refusé." });
  assert.equal(d2.calls.length, 0);
});

// ---------------------------------------------------------------------------
// The Gemini service (mocked client: Gemini is never called for real)
// ---------------------------------------------------------------------------

function fakeClient(text: string | Error) {
  const seen: Array<Parameters<TranscriptionClient["models"]["generateContent"]>[0]> = [];
  const client: TranscriptionClient = {
    models: {
      async generateContent(params) {
        seen.push(params);
        if (text instanceof Error) throw text;
        return { text };
      },
    },
  };
  return { client, seen };
}

test("service: sends the audio inline (base64, base MIME type) with a transcribe-don't-translate prompt", async () => {
  const { client, seen } = fakeClient("ch7al 3ndi men coca f stock ?");
  const text = await transcribeAudio({ audio: new Uint8Array([1, 2, 3]), mimeType: "audio/webm;codecs=opus" }, { client, model: "test-model" });
  assert.equal(text, "ch7al 3ndi men coca f stock ?");
  assert.equal(seen[0].model, "test-model");
  assert.equal(seen[0].config?.temperature, 0);
  const parts = seen[0].contents[0].parts;
  assert.deepEqual(parts[1], { inlineData: { mimeType: "audio/webm", data: Buffer.from([1, 2, 3]).toString("base64") } });
  const prompt = seen[0].config?.systemInstruction ?? "";
  assert.equal(prompt, TRANSCRIPTION_PROMPT);
  for (const rule of ["Ne traduis JAMAIS", "ch7al", "3ndi", "Ne réponds PAS", "aucun Markdown", "UNIQUEMENT la transcription"]) {
    assert.ok(prompt.includes(rule), rule);
  }
});

test("service: quotes and code fences around the transcription are removed, real content untouched", () => {
  assert.equal(cleanTranscription('  "ch7al 3ndi coca ?"  '), "ch7al 3ndi coca ?");
  assert.equal(cleanTranscription("«bonjour»"), "bonjour");
  assert.equal(cleanTranscription("```\nch7al 3ndi\n```"), "ch7al 3ndi");
  assert.equal(cleanTranscription("Coca 1L  x 2"), "Coca 1L  x 2");
  assert.equal(cleanTranscription("il a dit \"non\" hier"), 'il a dit "non" hier');
  assert.equal(baseMimeType("Audio/WebM; codecs=opus"), "audio/webm");
});

test("service: Gemini error -> PROVIDER, empty answer -> EMPTY, no key -> NOT_CONFIGURED", async () => {
  await assert.rejects(
    transcribeAudio({ audio: new Uint8Array([1]), mimeType: "audio/webm" }, { client: fakeClient(new Error("network")).client }),
    (error: unknown) => error instanceof SpeechToTextError && error.code === "PROVIDER",
  );
  await assert.rejects(
    transcribeAudio({ audio: new Uint8Array([1]), mimeType: "audio/webm" }, { client: fakeClient("   ").client }),
    (error: unknown) => error instanceof SpeechToTextError && error.code === "EMPTY",
  );
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      transcribeAudio({ audio: new Uint8Array([1]), mimeType: "audio/webm" }),
      (error: unknown) => error instanceof SpeechToTextError && error.code === "NOT_CONFIGURED",
    );
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});
