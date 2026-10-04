import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

/**
 * CLIENT PLATFORM (branch `client-platform`) - the external customer-facing
 * catalog is a SEPARATE surface from the staff ERP: a Customer is not a
 * User, so it cannot use the staff Session table (lib/server/auth.ts),
 * which is keyed on User.id and would otherwise force creating a fake staff
 * account (with a role, ERP permissions) for every customer - exactly what
 * must never happen.
 *
 * Instead this reuses the project's OTHER established pattern for a
 * narrow-purpose signed bearer/cookie token (see lib/server/tracking-token.ts,
 * same HMAC-then-compare shape) - a stateless, dedicated, easily-revoked-by-
 * rotating-the-secret token, signed with its own secret
 * (CLIENT_SESSION_SECRET), never AUTH_SECRET or any other token's secret.
 *
 * The token is opaque to the browser (a cookie value) but self-describing to
 * the server: it carries {organizationId, organizationCode, email}. This is
 * safe ONLY because it is signed (never accepted unless the signature
 * matches) and because every read of it (getCurrentClient in client-auth.ts)
 * re-checks the Organization it claims against the database on every
 * request - a session for a since-deactivated organization stops working
 * the moment that happens, exactly like the staff session does.
 *
 * There is deliberately no Customer here: a visitor identifies only by
 * email + Organization.code, and the email is carried as-is, never looked
 * up against Customer (see client-auth.ts's own doc comment).
 */
export type ClientSessionClaims = {
  organizationId: string;
  organizationCode: string;
  email: string;
};

type ClientSessionPayload = ClientSessionClaims & { exp: number };

const CLIENT_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h - a shopping session, not a persistent login.

export function signClientSessionToken(claims: ClientSessionClaims): { token: string; maxAgeSeconds: number } {
  const exp = Date.now() + CLIENT_SESSION_MAX_AGE_MS;
  const payload: ClientSessionPayload = { ...claims, exp };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${sign(body)}`, maxAgeSeconds: Math.floor(CLIENT_SESSION_MAX_AGE_MS / 1000) };
}

export function verifyClientSessionToken(token: string): ClientSessionClaims | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expectedSig = sign(body);
  const actualBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ClientSessionPayload>;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Date.now() ||
      !payload.organizationId ||
      !payload.organizationCode ||
      !payload.email
    ) {
      return null;
    }
    return { organizationId: payload.organizationId, organizationCode: payload.organizationCode, email: payload.email };
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
