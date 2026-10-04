import "server-only";

import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { signClientSessionToken, verifyClientSessionToken } from "@/lib/server/client-session-token";
import type { ClientSessionDto } from "@/types/client-portal";

/**
 * CLIENT PLATFORM (branch `client-platform`) - authentication for the
 * external customer-facing catalog. Deliberately separate from
 * lib/server/auth.ts (the staff ERP session): see client-session-token.ts's
 * own doc comment for why a signed cookie, not the staff Session table, is
 * the right building block here.
 *
 * V1 LOGIN, DELIBERATELY WITHOUT A CUSTOMER: a visitor identifies with only
 * an email and an Organization.code, no password, and does NOT need to
 * already exist as a Customer row. The email is carried as-is in the
 * session (kept for later use - a future order, a future account) but is
 * NEVER looked up or matched against Customer.email: Customer is untouched
 * by this feature entirely (never read, never written) - the only real
 * identity check is that Organization.code resolves to a real, ACTIVE
 * organisation.
 *
 * SECURITY (multi-tenant, the priority for this feature): organizationId is
 * NEVER accepted from the client as a parameter anywhere in this module or
 * its callers - it is always the one just resolved from Organization.code
 * (at login) or the one carried inside the verified, server-signed cookie
 * (on every later request). Every product/category read downstream
 * (lib/server/client-catalog.ts) takes ONLY that value.
 */

const CLIENT_SESSION_COOKIE = "comdis.client-session";

export class ClientAuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

/**
 * Resolves {email, organizationCode} to a real, ACTIVE Organization and sets
 * the signed session cookie. The email is validated only for shape (by the
 * route's own zod schema) and stored as given - never checked against any
 * table.
 */
export async function loginClient(input: { email: string; organizationCode: string }): Promise<ClientSessionDto> {
  const email = input.email.trim().toLowerCase();
  const organizationCode = input.organizationCode.trim();
  if (!email || !organizationCode) {
    throw new ClientAuthError("Email et code organisation sont obligatoires.", 422);
  }

  const organization = await prisma.organization.findUnique({
    where: { code: organizationCode },
    select: { id: true, code: true, status: true },
  });
  if (!organization || organization.status !== "ACTIVE") {
    throw new ClientAuthError("Organisation introuvable.", 404);
  }

  const { token, maxAgeSeconds } = signClientSessionToken({
    organizationId: organization.id,
    organizationCode: organization.code,
    email,
  });

  const cookieStore = await cookies();
  cookieStore.set(CLIENT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  });

  return { organizationId: organization.id, organizationCode: organization.code, email };
}

/**
 * The current client session, or null - re-checks the Organization it claims
 * fresh against the database on every call (never trusts the cookie's claim
 * alone), so a session for an organisation deactivated after the cookie was
 * issued stops working immediately, exactly like the staff session
 * (lib/server/auth.ts#getCurrentSessionUser). Never touches Customer.
 */
export async function getCurrentClient(): Promise<ClientSessionDto | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = verifyClientSessionToken(token);
  if (!claims) return null;

  const organization = await prisma.organization.findUnique({
    where: { id: claims.organizationId },
    select: { status: true },
  });
  if (!organization || organization.status !== "ACTIVE") return null;

  return claims;
}

/** Same authority as getCurrentClient(), but throws for a route/page that requires a session. */
export async function requireClient(): Promise<ClientSessionDto> {
  const client = await getCurrentClient();
  if (!client) throw new ClientAuthError("Session client introuvable.", 401);
  return client;
}

export async function logoutClient(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CLIENT_SESSION_COOKIE);
}
