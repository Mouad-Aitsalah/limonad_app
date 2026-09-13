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
 * No expiry is enforced (see this task's own "4. VALIDATION soldAt" - the
 * identical reasoning applies here: a network outage can legitimately last
 * days, and a token issued before the outage must still be usable once the
 * driver is back online). `issuedAt` is still signed and returned so a
 * future phase can add a policy-driven expiry without a token-format
 * change.
 */

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
