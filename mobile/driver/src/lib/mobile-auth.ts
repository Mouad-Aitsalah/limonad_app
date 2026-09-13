import { apiUrl } from "./api-base";
import { removeMobileAccessToken, saveMobileAccessToken } from "./secure-token-storage";

/**
 * PHASE 5A.1/5A.2 - client side of the mobile Bearer auth flow (see
 * app/api/mobile/auth/{login,logout}/route.ts). Deliberately its own tiny
 * module, not a copy of hooks/use-auth.tsx - that hook is cookie/`next/
 * navigation`-shaped and lives in the Next app; this one only ever deals
 * with a token string, persisted through secure-token-storage.ts.
 */

/** Mirrors types/auth.ts's CurrentUser (the server's login response shape) -
 *  duplicated as a plain literal type rather than imported, since that file
 *  lives in the Next app and nothing else here needs a shared dependency on
 *  it. */
export type MobileUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  nom: string;
  email: string;
  role: string;
  organizationId: string | null;
  driverId?: string;
  truckId?: string;
};

export type MobileLoginResult =
  | { success: true; accessToken: string; user: MobileUser }
  | { success: false; status: number; message: string };

/**
 * On success, the token is written to secure storage here (not left to the
 * caller) - "6. LOGIN MOBILE: si succes: accessToken -> saveMobileAccessToken".
 * Never logs the token, never returns it inside an error path.
 */
export async function loginMobile(email: string, password: string): Promise<MobileLoginResult> {
  let response: Response;
  try {
    response = await fetch(apiUrl("/api/mobile/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    return { success: false, status: 0, message: error instanceof Error ? error.message : "Erreur reseau." };
  }

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; accessToken?: string; user?: MobileUser; message?: string }
    | null;

  if (!response.ok || !payload?.success || !payload.accessToken || !payload.user) {
    return {
      success: false,
      status: response.status,
      message: payload?.message ?? `Erreur serveur (${response.status}).`,
    };
  }

  await saveMobileAccessToken(payload.accessToken);
  return { success: true, accessToken: payload.accessToken, user: payload.user };
}

/**
 * PHASE 5A.2 - "7. LOGOUT": revokes the server-side session when a network
 * call can plausibly succeed (best-effort - a failure here is never fatal),
 * but ALWAYS removes the local secure-stored token regardless of whether
 * that call succeeded, timed out, or was never attempted (no accessToken in
 * hand). Never touches SQLite - offline_context, the cached products/
 * customers/stock, offline_sales and sync_outbox all survive a logout
 * untouched (nothing in this module ever imports lib/offline/driver-pos).
 */
export async function logoutMobile(accessToken: string | null): Promise<void> {
  if (accessToken) {
    await fetch(apiUrl("/api/mobile/auth/logout"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => undefined);
  }
  await removeMobileAccessToken();
}
