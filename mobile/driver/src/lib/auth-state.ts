import type { DriverOfflineContext } from "@/lib/offline/driver-pos";

import { getMobileAccessToken, removeMobileAccessToken } from "./secure-token-storage";
import { mobileFetch } from "./mobile-fetch";

/**
 * PHASE 5A.2 - "10. ÉTATS AUTH CLAIRS".
 *
 * Deliberately NOT a boolean `isAuthenticated` - that would conflate "no
 * Internet" with "session invalid", which is exactly the mistake this task
 * calls out. Five states plus one addition of our own:
 *
 *  - BOOTING: the boot sequence (SQLite + token + network check) is running.
 *  - LOGIN_REQUIRED: online, no token at all - a first login is possible now.
 *  - SESSION_EXPIRED: online, a stored token was rejected with a real 401 -
 *    it has been removed already; distinct from LOGIN_REQUIRED only for the
 *    UI copy ("session expiree" vs a plain login prompt).
 *  - AUTHENTICATED: a token is present and (at boot) was verified with a
 *    real 200 from the server, OR was just minted by a fresh login.
 *  - OFFLINE_CONTEXT_ONLY: offline (or the server was unreachable - a
 *    network/5xx failure, never treated as a 401), but this device has a
 *    cached offline_context to show - "V1 dedicated-driver assumption" (see
 *    Phase 5A audit's own "7. ISOLATION UTILISATEUR"): this is a
 *    device-bound cache read, never a cryptographic re-authentication.
 *  - NO_OFFLINE_DATA: offline (or unreachable) AND no cached context at all
 *    - the "first launch, no Internet yet" case (task's own "15").
 */
export type BootState =
  | { kind: "BOOTING" }
  | { kind: "LOGIN_REQUIRED" }
  | { kind: "SESSION_EXPIRED" }
  | { kind: "AUTHENTICATED" }
  | { kind: "OFFLINE_CONTEXT_ONLY" }
  | { kind: "NO_OFFLINE_DATA" };

export type BootResult = {
  bootState: BootState;
  token: string | null;
};

/**
 * Resting-state computation with NO network call - used right after a fresh
 * login (the login call itself already proved the token) or right after a
 * logout (the token was just removed), where re-verifying over the network
 * would be redundant. Boot time is the one case that needs an actual check
 * (see runBootSequence below), because a stored token's validity is exactly
 * what is unknown at that point.
 */
export function deriveRestingBootState(
  token: string | null,
  online: boolean,
  context: DriverOfflineContext | null,
): BootState {
  if (token && online) return { kind: "AUTHENTICATED" };
  if (!token && online) return { kind: "LOGIN_REQUIRED" };
  return context ? { kind: "OFFLINE_CONTEXT_ONLY" } : { kind: "NO_OFFLINE_DATA" };
}

/**
 * PHASE 5A.2 - "8. RESTAURATION AU DÉMARRAGE", steps C/D onward (A/B - SQLite
 * + offline_context - are read by the caller, since they are needed
 * regardless of auth outcome). Only case that ever performs a network call:
 * a token is present AND the device reports itself online - anything else
 * is decided locally, with zero fetch.
 */
export async function runBootSequence(params: {
  online: boolean;
  context: DriverOfflineContext | null;
}): Promise<BootResult> {
  const token = await getMobileAccessToken();

  if (!token) {
    return { bootState: deriveRestingBootState(null, params.online, params.context), token: null };
  }

  if (!params.online) {
    // Token present, device offline: NEVER touch it, never guess it is
    // expired - see this task's own "8. ... NE PAS invalider le token".
    return { bootState: deriveRestingBootState(token, false, params.context), token };
  }

  const outcome = await mobileFetch("/api/driver/pos", token);

  if (outcome.kind === "ok") {
    return { bootState: { kind: "AUTHENTICATED" }, token };
  }

  if (outcome.kind === "unauthorized") {
    await removeMobileAccessToken();
    return { bootState: { kind: "SESSION_EXPIRED" }, token: null };
  }

  // network_error or server_error: "un echec reseau n'est PAS equivalent a
  // un 401" - the token is kept, and the shell falls back to whatever
  // offline_context it already has (or the no-cache message otherwise).
  return { bootState: deriveRestingBootState(token, false, params.context), token };
}
