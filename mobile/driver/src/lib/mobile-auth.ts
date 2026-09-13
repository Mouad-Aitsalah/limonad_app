import { apiUrl } from "./api-base";

/**
 * PHASE 5A.1 - client side of the mobile Bearer auth flow (see
 * app/api/mobile/auth/{login,logout}/route.ts). Deliberately its own tiny
 * module, not a copy of hooks/use-auth.tsx - that hook is cookie/`next/
 * navigation`-shaped and lives in the Next app; this one only ever deals
 * with a token string, in memory, for this shell.
 */

export type MobileUser = {
  id: string;
  role: string;
  organizationId: string | null;
  driverId?: string;
  [key: string]: unknown;
};

export type MobileLoginResult =
  | { success: true; accessToken: string; user: MobileUser }
  | { success: false; status: number; message: string };

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

  return { success: true, accessToken: payload.accessToken, user: payload.user };
}

export async function logoutMobile(accessToken: string): Promise<void> {
  await fetch(apiUrl("/api/mobile/auth/logout"), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined);
}

export type AuthenticatedApiTestResult = {
  status: number;
  ok: boolean;
  body: unknown;
};

/**
 * PHASE 5A.1 - "13. TEST API MOBILE": calls the already-existing
 * /api/driver/pos with (or deliberately without) a Bearer token, to prove
 * the whole chain end to end - 200 + a real driver context with a valid
 * token, 401 with none or a wrong one.
 */
export async function testAuthenticatedDriverApi(
  accessToken: string | null,
): Promise<AuthenticatedApiTestResult> {
  const headers: HeadersInit = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const response = await fetch(apiUrl("/api/driver/pos"), { method: "GET", headers });
  const body = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}
