import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  INITIAL_GATE_STATE,
  NETWORK_MESSAGE,
  REFRESH_FAILED_MESSAGE,
  SERVER_ERROR_MESSAGE,
  TIMEOUT_MESSAGE,
  UNEXPECTED_RESPONSE_MESSAGE,
  gateReducer,
  postSecurityRequest,
  type GateEvent,
  type GateState,
} from "@/components/dashboard/security/dashboard-gate-state";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const URL_UNLOCK = "/api/dashboard/security/unlock";
const URL_CREATE = "/api/dashboard/security/password";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const run = (events: GateEvent[], from: GateState = INITIAL_GATE_STATE) => events.reduce(gateReducer, from);

// ---- the request: always settles, every failure has a message ------------------------------------

test("request: success, and the payload is sent as JSON with an abort signal", async () => {
  let seen: { url: string; init?: RequestInit } | null = null;
  const result = await postSecurityRequest(URL_UNLOCK, { password: "x" }, {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return json(200, { ok: true });
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(seen!.url, URL_UNLOCK);
  assert.equal(seen!.init?.method, "POST");
  assert.equal(seen!.init?.body, JSON.stringify({ password: "x" }));
  assert.ok(seen!.init?.signal, "the 20 s timeout is wired through an AbortSignal");
});

test("request: a refusal (4xx) shows the server's own message; the creation endpoint behaves the same", async () => {
  for (const url of [URL_UNLOCK, URL_CREATE]) {
    assert.deepEqual(await postSecurityRequest(url, { password: "x" }, { fetchImpl: async () => json(401, { message: "Mot de passe invalide." }) }), {
      ok: false,
      message: "Mot de passe invalide.",
    });
    assert.deepEqual(await postSecurityRequest(url, { password: "x" }, { fetchImpl: async () => json(429, { message: "Trop de tentatives." }) }), {
      ok: false,
      message: "Trop de tentatives.",
    });
  }
  assert.deepEqual(await postSecurityRequest(URL_CREATE, { password: "x" }, { fetchImpl: async () => json(422, { message: "Les deux mots de passe ne correspondent pas." }) }), {
    ok: false,
    message: "Les deux mots de passe ne correspondent pas.",
  });
});

test("request: unreadable or empty refusal, and server errors, give explicit generic messages (no raw body shown)", async () => {
  assert.deepEqual(await postSecurityRequest(URL_UNLOCK, {}, { fetchImpl: async () => new Response("<html>oops</html>", { status: 403 }) }), { ok: false, message: UNEXPECTED_RESPONSE_MESSAGE });
  assert.deepEqual(await postSecurityRequest(URL_UNLOCK, {}, { fetchImpl: async () => json(400, {}) }), { ok: false, message: UNEXPECTED_RESPONSE_MESSAGE });
  assert.deepEqual(await postSecurityRequest(URL_UNLOCK, {}, { fetchImpl: async () => json(400, { message: 42 }) }), { ok: false, message: UNEXPECTED_RESPONSE_MESSAGE });
  assert.deepEqual(await postSecurityRequest(URL_UNLOCK, {}, { fetchImpl: async () => json(500, { message: "Impossible de vérifier le mot de passe." }) }), { ok: false, message: SERVER_ERROR_MESSAGE });
  assert.deepEqual(await postSecurityRequest(URL_UNLOCK, {}, { fetchImpl: async () => new Response("Bad gateway", { status: 502 }) }), { ok: false, message: SERVER_ERROR_MESSAGE });
});

test("request: a network error ends with a network message", async () => {
  const result = await postSecurityRequest(URL_UNLOCK, {}, {
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.deepEqual(result, { ok: false, message: NETWORK_MESSAGE });
});

test("request: a hanging request is aborted at the timeout and ends with a timeout message", async () => {
  const startedAt = Date.now();
  const result = await postSecurityRequest(URL_UNLOCK, {}, {
    timeoutMs: 40,
    fetchImpl: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  assert.deepEqual(result, { ok: false, message: TIMEOUT_MESSAGE });
  assert.ok(Date.now() - startedAt < 2_000, "settles promptly, never hangs");
});

test("request: the production timeout is 20 seconds", () => {
  const source = read("components/dashboard/security/dashboard-gate-state.ts");
  assert.match(source, /SECURITY_REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(source, /REFRESH_TIMEOUT_MS = 20_000/);
  assert.match(source, /clearTimeout\(timer\)/, "the timer is always cleared (finally)");
});

// ---- the loading state machine -----------------------------------------------------------------------

test("state: successful validation -> submitting -> refreshing; the screen then disappears (nothing more to do)", () => {
  const submitting = run([{ type: "submit" }]);
  assert.equal(submitting.phase, "submitting");
  const refreshing = gateReducer(submitting, { type: "validated" });
  assert.deepEqual(refreshing, { phase: "refreshing", error: null, refreshFailed: false });
});

test("state: a refusal, a server error, a network error or a timeout always returns to idle with the message", () => {
  for (const message of ["Mot de passe invalide.", SERVER_ERROR_MESSAGE, NETWORK_MESSAGE, TIMEOUT_MESSAGE]) {
    const state = run([{ type: "submit" }, { type: "rejected", message }]);
    assert.deepEqual(state, { phase: "idle", error: message, refreshFailed: false });
  }
});

test("state: password validated but the dashboard did not open -> explicit message, NOT an authentication failure, back to idle", () => {
  const state = run([{ type: "submit" }, { type: "validated" }, { type: "refresh-ended" }]);
  assert.equal(state.phase, "idle", "the button is usable again");
  assert.equal(state.error, REFRESH_FAILED_MESSAGE);
  assert.equal(state.refreshFailed, true);
  assert.match(REFRESH_FAILED_MESSAGE, /validé/);
  assert.doesNotMatch(REFRESH_FAILED_MESSAGE, /invalide|incorrect|refusé/i);
});

test("state: no event can leave the screen stuck - 'submit' is ignored while busy, 'refresh-ended' only acts while refreshing", () => {
  const busy = run([{ type: "submit" }]);
  assert.equal(gateReducer(busy, { type: "submit" }), busy, "a second submit while busy changes nothing");
  assert.equal(gateReducer(INITIAL_GATE_STATE, { type: "refresh-ended" }), INITIAL_GATE_STATE);
  assert.equal(gateReducer(busy, { type: "refresh-ended" }), busy);
  // a retry after any failure starts clean
  const failed = run([{ type: "submit" }, { type: "rejected", message: "x" }]);
  assert.deepEqual(gateReducer(failed, { type: "submit" }), { phase: "submitting", error: null, refreshFailed: false });
  const refreshFailed = run([{ type: "submit" }, { type: "validated" }, { type: "refresh-ended" }]);
  assert.deepEqual(gateReducer(refreshFailed, { type: "submit" }), { phase: "submitting", error: null, refreshFailed: false });
});

// ---- both screens (unlock AND first creation) use the same safe path ------------------------------

test("the unlock dialog and the creation card both go through the safe submission hook (no raw fetch, no stuck spinner)", () => {
  const gate = read("components/dashboard/security/dashboard-security-gate.tsx");
  assert.equal((gate.match(/useGateSubmission\(/g) ?? []).length, 3, "hook definition + unlock + creation");
  assert.match(gate, /useGateSubmission\(UNLOCK_ENDPOINT\)/);
  assert.match(gate, /useGateSubmission\(PASSWORD_ENDPOINT\)/);
  assert.doesNotMatch(gate, /\bfetch\(/, "requests only go through postSecurityRequest (timeout + classification)");
  assert.doesNotMatch(gate, /setPending/, "no hand-managed loading flag left");
  assert.match(gate, /startRefresh\(\(\) => router\.refresh\(\)\)/, "the refresh runs in a transition that is awaited");
  assert.match(gate, /REFRESH_TIMEOUT_MS/);
  assert.match(gate, /data-testid="dashboard-gate-reload"/);
  // the error line is shared by both screens
  assert.match(gate, /<GateMessage state=\{state\} testId="dashboard-unlock-error" \/>/);
  assert.match(gate, /<GateMessage state=\{state\} testId="dashboard-password-error" \/>/);
});
