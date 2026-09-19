import type { SaveCustomerRequest } from "@/components/driver-clients/driver-clients-view";
import type { QuickCustomerCreator } from "@/components/driver-tour/quick-add-customer-dialog";
import type { CustomerDto } from "@/types/operations-dto";

import { apiUrl } from "./api-base";

/**
 * Bearer transports for the two customer-creation flows the Android shell
 * offers - two DIFFERENT screens that share only the API family:
 *
 *  - quick add from the map ("Ajouter un client", the compact name + GPS
 *    modal)      -> POST /api/driver/customers/quick
 *  - "Mes clients" -> "Nouveau client" (the full form)
 *                 -> POST /api/driver/customers
 *
 * Both routes accept `Authorization: Bearer` (CORS + cookie-CSRF exemption for
 * Bearer requests, same pattern as ÉTAPE 28A). Deliberately not built on
 * mobileFetch: the full form needs the server's `fieldErrors` from a 4xx body,
 * which mobileFetch's outcome does not carry. The token is only ever put in the
 * Authorization header - never logged, never in an error message.
 */

const TIMEOUT_MS = 15_000;

const SESSION_EXPIRED = "Session expiree. Reconnectez-vous.";
const NETWORK_ERROR = "Connexion impossible. Verifiez Internet puis reessayez.";
const TIMEOUT_ERROR = "Le serveur met trop de temps a repondre. Reessayez.";
const SAVE_ERROR = "Impossible d'enregistrer le client.";

type CustomerPayload = {
  customer?: CustomerDto;
  message?: string;
  fieldErrors?: Record<string, string>;
};

type PostOutcome =
  | { kind: "response"; ok: boolean; status: number; payload: CustomerPayload }
  | { kind: "failure"; message: string };

async function postWithBearer(path: string, token: string | null, body: unknown): Promise<PostOutcome> {
  if (!token) return { kind: "failure", message: SESSION_EXPIRED };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status === 401) return { kind: "failure", message: SESSION_EXPIRED };
    const payload = ((await response.json().catch(() => null)) ?? {}) as CustomerPayload;
    return { kind: "response", ok: response.ok, status: response.status, payload };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return { kind: "failure", message: timedOut ? TIMEOUT_ERROR : NETWORK_ERROR };
  } finally {
    clearTimeout(timer);
  }
}

/** Compact map modal: { name, latitude, longitude, locationAccuracy } only. */
export function createShellQuickCustomerCreator(token: string | null): QuickCustomerCreator {
  return async (input) => {
    const outcome = await postWithBearer("/api/driver/customers/quick", token, input);
    if (outcome.kind === "failure") return { message: outcome.message };
    if (!outcome.ok || !outcome.payload.customer) {
      return { message: outcome.payload.message ?? SAVE_ERROR };
    }
    return { customer: outcome.payload.customer };
  };
}

/** Full "Nouveau client" form: every field, optional location. */
export function createShellSaveCustomerRequest(token: string | null): SaveCustomerRequest {
  return async (body) => {
    const outcome = await postWithBearer("/api/driver/customers", token, body);
    if (outcome.kind === "failure") return { ok: false, payload: { message: outcome.message } };
    return { ok: outcome.ok, payload: outcome.payload };
  };
}
