import "server-only";

import { cookies } from "next/headers";

import { CLIENT_LOGIN_FAILED_MESSAGE, CLIENT_LOGIN_THROTTLED_MESSAGE } from "@/lib/client-portal-rules";
import { prisma } from "@/lib/prisma";
import { authenticateClient, resolveClientIdentity } from "@/lib/server/client-portal-core";
import { isOrganizationModuleEnabled } from "@/lib/server/module-guard";
import { signClientSessionToken, verifyClientSessionToken } from "@/lib/server/client-session-token";
import type { ClientSessionDto } from "@/types/client-portal";

/**
 * Espace Client - authentication, deliberately separate from
 * lib/server/auth.ts (the staff ERP session): its own signed cookie
 * (client-session-token.ts), never accepted by any staff route
 * (requireOrganizationUser only ever reads the staff cookie).
 *
 * Identification = organisation code + customer code (both mandatory), no
 * password/PIN by business decision. These two codes are NOT secrets, so the
 * session only opens the ordering space: catalogue + the customer's own
 * orders, never any ERP data. The optional phone is contact info only.
 *
 * SECURITY: organizationId / customerId are NEVER accepted from the request:
 * they come from authenticateClient at login, then from the verified cookie,
 * re-checked against the database on every request (organisation and
 * customer still ACTIVE and still linked) - a blocked customer or a
 * deactivated organisation is logged out immediately.
 *
 * MODULES: the Espace client belongs to the "Commandes en ligne" module
 * (lib/modules). When the SUPER_ADMIN disables it for the organisation, the
 * login is refused and an open session is no longer recognised - every client
 * page (redirected to the login) and every /api/client route (401) is closed.
 */

const CLIENT_SPACE_DISABLED_MESSAGE = "L'espace client n'est pas disponible pour cette organisation.";

const CLIENT_SESSION_COOKIE = "comdis.client-session";

export class ClientAuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

export async function loginClient(
  input: { organizationCode: string; customerCode: string; contactPhone: string | null },
  meta: { ip: string },
): Promise<ClientSessionDto> {
  const result = await authenticateClient(prisma, input, meta);
  if (!result.ok) {
    throw result.reason === "THROTTLED"
      ? new ClientAuthError(CLIENT_LOGIN_THROTTLED_MESSAGE, 429)
      : new ClientAuthError(CLIENT_LOGIN_FAILED_MESSAGE, 401);
  }

  const { identity } = result;
  if (!(await isOrganizationModuleEnabled(identity.organizationId, "customerOrders"))) {
    throw new ClientAuthError(CLIENT_SPACE_DISABLED_MESSAGE, 403);
  }
  const { token, maxAgeSeconds } = signClientSessionToken({
    organizationId: identity.organizationId,
    customerId: identity.customerId,
    contactPhone: input.contactPhone,
  });

  const cookieStore = await cookies();
  cookieStore.set(CLIENT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  });

  return { ...identity, contactPhone: input.contactPhone };
}

/** The current client session, or null (no/invalid/expired cookie, or org/customer no longer ACTIVE). */
export async function getCurrentClient(): Promise<ClientSessionDto | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = verifyClientSessionToken(token);
  if (!claims) return null;

  const identity = await resolveClientIdentity(prisma, claims);
  if (!identity) return null;
  if (!(await isOrganizationModuleEnabled(identity.organizationId, "customerOrders"))) return null;
  return { ...identity, contactPhone: claims.contactPhone };
}

/** Same authority as getCurrentClient(), but throws for a route that requires a session. */
export async function requireClient(): Promise<ClientSessionDto> {
  const client = await getCurrentClient();
  if (!client) throw new ClientAuthError("Session client introuvable ou expirée.", 401);
  return client;
}

export async function logoutClient(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CLIENT_SESSION_COOKIE);
}
