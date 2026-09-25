import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * PHASE 4A.1 - "PRIX OFFLINE FIGÉ ET VÉRIFIABLE".
 *
 * When the driver POS fetches its product list (getDriverPosContext), every
 * product is stamped with a signed token attesting "this org/product/price
 * combination was genuinely issued by the server at this instant". The
 * phone caches the token alongside the price (see lib/offline/driver-pos/
 * schema.ts's cached_products.priceToken) and freezes a COPY of it onto
 * each offline_sale_line at the moment of the offline sale (never re-reads
 * the cache's current token later - a later price change must never
 * retroactively alter what an already-confirmed offline sale claims to
 * have shown the driver).
 *
 * At sync time (syncOfflineDriverSale), the token is re-verified: if the
 * signature checks out AND its productId/organizationId match, the signed
 * unitPriceTTC is trusted as the real historical price - even if the
 * server's current Product.salePrice has since changed. A token that
 * fails verification (bad signature, wrong org, wrong product, or a
 * unitPriceTTC that doesn't match what was actually signed) means the
 * payload was tampered with or corrupted: the whole sale is refused, never
 * silently repriced.
 *
 * PHASE 2.1b - a token is honoured only if the sale was made no more than
 * OFFLINE_PRICE_TOKEN_MAX_AGE_HOURS (default 7 days) after the token was
 * issued - see checkOfflinePriceTokenFreshness below. The window is measured
 * against the sale's own soldAt, never against the moment of synchronisation,
 * so a long outage does not by itself invalidate a sale made while the
 * token was still fresh. The token format is unchanged, so tokens already
 * cached on devices stay valid.
 */

const MAX_AGE_ENV_VAR = "OFFLINE_PRICE_TOKEN_MAX_AGE_HOURS";
const DEFAULT_MAX_AGE_HOURS = 24 * 7;

const SECRET_ENV_VAR = "OFFLINE_PRICE_SIGNING_SECRET";

export type OfflinePriceTokenPayload = {
  organizationId: string;
  productId: string;
  unitPriceTTC: number;
  issuedAt: string;
};

function getSigningSecret(): string {
  const secret = process.env[SECRET_ENV_VAR];
  if (!secret) {
    throw new Error(
      `${SECRET_ENV_VAR} is not configured - offline price tokens cannot be issued or verified.`,
    );
  }
  return secret;
}

/** Stable, explicit field order - never a raw JSON.stringify(payload) of an
 *  object literal (key order there is an implementation detail, not a
 *  contract), so the exact bytes being signed stay obvious on inspection. */
function canonicalPayload(payload: OfflinePriceTokenPayload): string {
  return [
    payload.organizationId,
    payload.productId,
    payload.unitPriceTTC.toFixed(2),
    payload.issuedAt,
  ].join("|");
}

function sign(payload: OfflinePriceTokenPayload): string {
  return createHmac("sha256", getSigningSecret())
    .update(canonicalPayload(payload))
    .digest("base64url");
}

/** Issues a fresh signed token for one product/price pair - called once per
 *  product every time getDriverPosContext runs (online only; the offline
 *  cache just stores whatever it was last given). */
export function signOfflinePrice(
  input: Pick<OfflinePriceTokenPayload, "organizationId" | "productId" | "unitPriceTTC">,
): string {
  const payload: OfflinePriceTokenPayload = { ...input, issuedAt: new Date().toISOString() };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(payload)}`;
}

export type OfflinePriceTokenVerification =
  | { valid: true; payload: OfflinePriceTokenPayload }
  | { valid: false; reason: string };

/** Verifies a token's signature and shape only - the caller (
 *  syncOfflineDriverSale) still has to check the verified payload's
 *  organizationId/productId/unitPriceTTC actually match the sale it's
 *  attached to. Never throws. */
export function verifyOfflinePriceToken(token: string): OfflinePriceTokenVerification {
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return { valid: false, reason: "malformed token" };
  const encodedPayload = token.slice(0, separatorIndex);
  const mac = token.slice(separatorIndex + 1);

  let payload: OfflinePriceTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed payload" };
  }
  if (
    !payload ||
    typeof payload.organizationId !== "string" ||
    typeof payload.productId !== "string" ||
    typeof payload.unitPriceTTC !== "number" ||
    !Number.isFinite(payload.unitPriceTTC) ||
    typeof payload.issuedAt !== "string"
  ) {
    return { valid: false, reason: "malformed payload shape" };
  }

  let expectedMac: string;
  try {
    expectedMac = sign(payload);
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : "signing secret unavailable" };
  }
  const actual = Buffer.from(mac);
  const expected = Buffer.from(expectedMac);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { valid: false, reason: "signature mismatch" };
  }
  return { valid: true, payload };
}

/** Maximum token age in ms. Unset, empty, non-numeric or non-positive values
 *  fall back to the default rather than silently disabling the check. */
export function getOfflinePriceTokenMaxAgeMs(): number {
  const raw = process.env[MAX_AGE_ENV_VAR];
  const hours = raw ? Number(raw) : Number.NaN;
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MAX_AGE_HOURS) * 60 * 60 * 1000;
}

export type OfflinePriceTokenFreshness =
  | { fresh: true }
  | { fresh: false; reason: "invalid_issued_at" | "too_old"; ageMs?: number; maxAgeMs?: number };

/**
 * Whether a (signature-verified) token was still within its allowed age when
 * the sale was made. A token issued AFTER soldAt (device clock behind the
 * server's) is treated as fresh: it can only carry a newer price than the
 * sale saw, and a clock skew of that kind must not reject a real sale.
 */
export function checkOfflinePriceTokenFreshness(
  payload: OfflinePriceTokenPayload,
  soldAt: Date,
  maxAgeMs: number = getOfflinePriceTokenMaxAgeMs(),
): OfflinePriceTokenFreshness {
  const issuedAtMs = new Date(payload.issuedAt).getTime();
  if (Number.isNaN(issuedAtMs)) return { fresh: false, reason: "invalid_issued_at" };
  const ageMs = soldAt.getTime() - issuedAtMs;
  if (ageMs > maxAgeMs) return { fresh: false, reason: "too_old", ageMs, maxAgeMs };
  return { fresh: true };
}
