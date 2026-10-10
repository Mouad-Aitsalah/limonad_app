import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

import { CLIENT_SESSION_MAX_AGE_SECONDS } from "@/lib/client-portal-rules";

/**
 * Espace Client - the external customer-facing ordering space is a SEPARATE
 * surface from the staff ERP: a Customer is not a User, so it cannot use the
 * staff Session table (lib/server/auth.ts), which is keyed on User.id and
 * would otherwise force creating a fake staff account (with a role, ERP
 * permissions) for every customer - exactly what must never happen.
 *
 * Instead this reuses the project's OTHER established pattern for a
 * narrow-purpose signed token (see lib/server/tracking-token.ts, same
 * HMAC-then-compare shape), signed with its own secret
 * (CLIENT_SESSION_SECRET), never AUTH_SECRET or any other token's secret.
 *
 * The token carries {organizationId, customerId, contactPhone}. This is safe
 * ONLY because it is signed (never accepted unless the signature matches) and
 * because every read of it (getCurrentClient in client-auth.ts) re-checks the
 * Organization AND the Customer against the database on every request - a
 * session for a since-deactivated organisation or a blocked customer stops
 * working the moment that happens. contactPhone is informative only.
 */
export type ClientSessionClaims = {
  organizationId: string;
  customerId: string;
  contactPhone: string | null;
};

type ClientSessionPayload = ClientSessionClaims & { exp: number; v: 2 };

export function signClientSessionToken(
  claims: ClientSessionClaims,
  now: number = Date.now(),
): { token: string; maxAgeSeconds: number } {
  const payload: ClientSessionPayload = { ...claims, exp: now + CLIENT_SESSION_MAX_AGE_SECONDS * 1000, v: 2 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${sign(body)}`, maxAgeSeconds: CLIENT_SESSION_MAX_AGE_SECONDS };
}

export function verifyClientSessionToken(token: string, now: number = Date.now()): ClientSessionClaims | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;

  const expectedSig = sign(body);
  const actualBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ClientSessionPayload>;
    if (
      payload.v !== 2 ||
      typeof payload.exp !== "number" ||
      payload.exp < now ||
      typeof payload.organizationId !== "string" ||
      !payload.organizationId ||
      typeof payload.customerId !== "string" ||
      !payload.customerId
    ) {
      return null;
    }
    return {
      organizationId: payload.organizationId,
      customerId: payload.customerId,
      contactPhone: typeof payload.contactPhone === "string" ? payload.contactPhone : null,
    };
  } catch {
    return null;
  }
}

function sign(value: string) {
  return createHmac("sha256", clientSessionSecret()).update(value).digest("base64url");
}

function clientSessionSecret(): string {
  const secret = process.env.CLIENT_SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") {
    // Local dev only, deliberately obvious/insecure - never reached in production.
    return "dev-only-client-session-secret-change-me";
  }
  throw new Error("CLIENT_SESSION_SECRET n'est pas configure.");
}
