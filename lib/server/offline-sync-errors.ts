import "server-only";

import { OperationsServiceError } from "@/lib/server/depots";

/**
 * PHASE 2.1b - machine-readable error codes for offline-sale synchronisation.
 *
 * Shared by syncOfflineDriverSale (lib/server/driver-sales.ts) and, later, by
 * lib/server/counter-sales-sync.ts. Pre-existing code names are kept exactly
 * as they were on the wire (a client already in the field matches on them),
 * so the mapping to a generic vocabulary is:
 *   PRICE_CHANGED     = LEGACY_OFFLINE_PRICE_MISMATCH
 *   INVALID_PAYMENT   = UNSUPPORTED_OFFLINE_PAYMENT_METHOD
 *   VALIDATION_ERROR  = INVALID_QUANTITY | INVALID_PRICE | INVALID_SOLD_AT
 *   SERVER_ERROR      = SALE_SYNC_FAILED
 * There is deliberately no PRODUCT_INACTIVE (the sale services filter
 * status = ACTIVE in the same query, so "inactive" and "missing" cannot be
 * told apart) and no STOCK_ERROR (no sale path ever rejects for stock:
 * negative stock is an explicit business rule).
 */
export type OfflineSyncErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "UNSUPPORTED_OFFLINE_PAYMENT_METHOD"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "INVALID_SOLD_AT"
  | "INVALID_OFFLINE_PRICE_TOKEN"
  | "OFFLINE_PRICE_TOKEN_EXPIRED"
  | "LEGACY_OFFLINE_PRICE_MISMATCH"
  | "DRIVER_CONTEXT_NOT_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_INACTIVE"
  | "CREDIT_LIMIT_EXCEEDED"
  | "PRODUCT_NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "SALE_SYNC_FAILED";

/**
 * Codes for which resending the exact same sale can never succeed - the
 * client must stop retrying it and surface it for review. Everything else
 * (network, 5xx, an unrecognised failure) stays retryable, the same safer
 * default the client already had.
 */
const NON_RETRYABLE_CODES: ReadonlySet<OfflineSyncErrorCode> = new Set([
  "FORBIDDEN",
  "UNSUPPORTED_OFFLINE_PAYMENT_METHOD",
  "INVALID_QUANTITY",
  "INVALID_PRICE",
  "INVALID_SOLD_AT",
  "INVALID_OFFLINE_PRICE_TOKEN",
  "OFFLINE_PRICE_TOKEN_EXPIRED",
  "LEGACY_OFFLINE_PRICE_MISMATCH",
  "CUSTOMER_NOT_FOUND",
  "CUSTOMER_INACTIVE",
  "CREDIT_LIMIT_EXCEEDED",
  "PRODUCT_NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
]);

/**
 * `SALE_SYNC_FAILED` is the generic bucket: it is retryable only for a real
 * server-side failure (5xx). A 4xx that reached it (an unrecognised business
 * rejection) would only be reproduced by resending the same payload.
 */
export function isRetryableSyncError(code: OfflineSyncErrorCode, status: number): boolean {
  if (code === "AUTH_REQUIRED") return true;
  if (code === "SALE_SYNC_FAILED") return status >= 500;
  return !NON_RETRYABLE_CODES.has(code);
}

/**
 * Exact messages thrown by createDriverSale / createCounterSale
 * (lib/server/driver-sales.ts, lib/server/counter-sales.ts). Those services
 * throw OperationsServiceError with only a message and a status - no code -
 * and must not be modified, so the code is derived here, from the exact
 * message first (never a substring), then from the status. A reworded
 * message in those services falls through to the status-based mapping below
 * instead of being silently misclassified.
 */
const CODE_BY_EXACT_MESSAGE: Record<string, OfflineSyncErrorCode> = {
  "Aucun camion n'est affecte a votre compte.": "DRIVER_CONTEXT_NOT_FOUND",
  "Profil chauffeur ou camion invalide.": "DRIVER_CONTEXT_NOT_FOUND",
  "Stock camion introuvable.": "DRIVER_CONTEXT_NOT_FOUND",
  "Client introuvable.": "CUSTOMER_NOT_FOUND",
  "Client inactif ou bloque.": "CUSTOMER_INACTIVE",
  "Plafond de credit depasse.": "CREDIT_LIMIT_EXCEEDED",
  "Un produit est introuvable.": "PRODUCT_NOT_FOUND",
  "Produit introuvable.": "PRODUCT_NOT_FOUND",
};

export function mapSaleServiceErrorToSyncCode(error: OperationsServiceError): OfflineSyncErrorCode {
  const byMessage = CODE_BY_EXACT_MESSAGE[error.message];
  if (byMessage) return byMessage;
  if (error.status === 409) return "CONFLICT";
  return "SALE_SYNC_FAILED";
}
