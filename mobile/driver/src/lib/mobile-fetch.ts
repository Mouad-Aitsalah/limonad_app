import { apiUrl } from "./api-base";

/**
 * PHASE 5A.2 - "9. GESTION 401 CENTRALISÉE".
 *
 * The one place that attaches `Authorization: Bearer` and classifies the
 * result into exactly the distinction the boot/auth logic needs: a REAL
 * 401 from the server (the token is genuinely invalid/expired/revoked) is
 * never confused with a network failure, a timeout, or a 5xx (the server is
 * fine but something else broke) - "un echec reseau n'est PAS equivalent a
 * un 401" (see this task's own "8. RESTAURATION AU DEMARRAGE"). Never logs
 * the token, in any branch, including error messages.
 */

const MOBILE_FETCH_TIMEOUT_MS = 10000;

/** The network_error message a timed-out call carries - exported so callers can
 *  tell "the server was too slow" from "no connection" without a new outcome kind. */
export const MOBILE_FETCH_TIMEOUT_MESSAGE = "Delai d'attente depasse.";

export type MobileFetchOutcome<T> =
  | { kind: "ok"; status: number; data: T }
  | { kind: "unauthorized" }
  | { kind: "server_error"; status: number; message: string }
  | { kind: "network_error"; message: string };

export async function mobileFetch<T = unknown>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<MobileFetchOutcome<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MOBILE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });

    if (response.status === 401) {
      return { kind: "unauthorized" };
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return {
        kind: "server_error",
        status: response.status,
        message: body?.message ?? `Erreur serveur (${response.status}).`,
      };
    }

    const data = (await response.json().catch(() => null)) as T;
    return { kind: "ok", status: response.status, data };
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? MOBILE_FETCH_TIMEOUT_MESSAGE
        : error instanceof Error
          ? error.message
          : "Erreur reseau.";
    return { kind: "network_error", message };
  } finally {
    clearTimeout(timeout);
  }
}
