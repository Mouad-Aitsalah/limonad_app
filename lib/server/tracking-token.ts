import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Short-lived, signed bearer token authenticating the Capacitor driver
 * app's *native* background GPS POSTs (app/api/driver/tour/location/native).
 *
 * The native background-geolocation plugin posts straight from Android/iOS
 * code once the WebView is suspended - it cannot rely on the app's
 * HttpOnly session cookie (no WebView, no cookie jar involved in that
 * request). This token is the replacement: minted once, server-side, from
 * an already-authenticated driver session, then handed to the plugin as an
 * `Authorization: Bearer` header for the lifetime of the tracking session.
 *
 * Deliberately signed with its own secret (BACKGROUND_TRACKING_SECRET),
 * never AUTH_SECRET - a leaked tracking token (long-lived, held on a phone,
 * sent over the network on every ping) must never double as a session
 * token, and vice versa.
 */
export type TrackingTokenClaims = {
  userId: string;
  driverId: string;
  organizationId: string;
  tourId: string;
};

type TrackingTokenPayload = TrackingTokenClaims & { exp: number };

const TRACKING_TOKEN_MAX_AGE_MS = 16 * 60 * 60 * 1000;

export function signTrackingToken(
  claims: TrackingTokenClaims,
): { token: string; expiresAt: string } {
  const exp = Date.now() + TRACKING_TOKEN_MAX_AGE_MS;
  const payload: TrackingTokenPayload = { ...claims, exp };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp).toISOString() };
}

export function verifyTrackingToken(token: string): TrackingTokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expectedSig = sign(body);
  const actualBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TrackingTokenPayload>;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Date.now() ||
      !payload.userId ||
      !payload.driverId ||
      !payload.organizationId ||
      !payload.tourId
    ) {
      return null;
    }
    return payload as TrackingTokenPayload;
  } catch {
    return null;
  }
}

function sign(value: string) {
  return createHmac("sha256", trackingSecret()).update(value).digest("base64url");
}

function trackingSecret(): string {
  const secret = process.env.BACKGROUND_TRACKING_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") {
    return "comdis-local-dev-tracking-secret";
  }
  throw new Error("BACKGROUND_TRACKING_SECRET n'est pas configure.");
}
