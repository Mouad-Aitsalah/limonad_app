/**
 * Pure logic of the dashboard password screens (unlock / create): the request with a hard timeout and every
 * failure mapped to a message, and the small state machine that keeps the "loading" state from ever getting
 * stuck. No React, no DOM: unit-tested directly (dashboard-gate-state.test.ts).
 */

/** A request that takes longer than this ends with an explicit message (never an endless spinner). */
export const SECURITY_REQUEST_TIMEOUT_MS = 20_000;
/** After a validated password, the dashboard must open within this delay or the screen explains it did not. */
export const REFRESH_TIMEOUT_MS = 20_000;

export const TIMEOUT_MESSAGE = "Le serveur met trop de temps à répondre. Réessayez dans un instant.";
export const NETWORK_MESSAGE = "Connexion impossible. Vérifiez votre réseau puis réessayez.";
export const UNEXPECTED_RESPONSE_MESSAGE = "Réponse inattendue du serveur. Réessayez.";
export const SERVER_ERROR_MESSAGE = "Le service est momentanément indisponible. Réessayez dans un instant.";
/** Shown when the password WAS accepted but the dashboard did not open: it is not an authentication failure. */
export const REFRESH_FAILED_MESSAGE =
  "Votre mot de passe a bien été validé, mais le dashboard ne s'est pas ouvert. Rechargez la page : le mot de passe vous sera redemandé une dernière fois.";

export type SecurityRequestResult = { ok: true } | { ok: false; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * POST JSON and classify the outcome. Never throws, always settles: success, a refusal (4xx with the server's
 * own message), a server failure (5xx), an unreadable answer, a network error or the timeout.
 */
export async function postSecurityRequest(
  url: string,
  payload: Record<string, string>,
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<SecurityRequestResult> {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SECURITY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    if (response.status >= 500) return { ok: false, message: SERVER_ERROR_MESSAGE };
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === "object" ? (body as { message?: unknown }).message : null;
    return { ok: false, message: typeof message === "string" && message ? message : UNEXPECTED_RESPONSE_MESSAGE };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      return { ok: false, message: TIMEOUT_MESSAGE };
    }
    return { ok: false, message: NETWORK_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}

// --- loading state machine ------------------------------------------------------------------

export type GatePhase = "idle" | "submitting" | "refreshing";
export type GateState = { phase: GatePhase; error: string | null; refreshFailed: boolean };
export type GateEvent =
  | { type: "submit" }
  | { type: "rejected"; message: string }
  | { type: "validated" }
  | { type: "refresh-ended" };

export const INITIAL_GATE_STATE: GateState = { phase: "idle", error: null, refreshFailed: false };

/**
 * idle -> submitting -> (rejected: idle + message) | (validated: refreshing).
 * refreshing ends either by the screen disappearing (the dashboard opened: nothing more to do) or by
 * "refresh-ended" while it is still shown: back to idle with an explicit message that is NOT an
 * authentication failure. Every path leaves "submitting" and "refreshing", so the button is never stuck.
 */
export function gateReducer(state: GateState, event: GateEvent): GateState {
  switch (event.type) {
    case "submit":
      return state.phase === "idle" ? { phase: "submitting", error: null, refreshFailed: false } : state;
    case "rejected":
      return { phase: "idle", error: event.message, refreshFailed: false };
    case "validated":
      return { phase: "refreshing", error: null, refreshFailed: false };
    case "refresh-ended":
      return state.phase === "refreshing" ? { phase: "idle", error: REFRESH_FAILED_MESSAGE, refreshFailed: true } : state;
    default:
      return state;
  }
}
