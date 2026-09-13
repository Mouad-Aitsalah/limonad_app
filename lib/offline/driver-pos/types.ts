/**
 * Offline POS chauffeur - Phase 1 (foundation only).
 *
 * These types describe what lives in the local SQLite database (see
 * schema.ts). Nothing here is sent to, or read from, the server - that is a
 * later phase. Phase 1 only: cache the online context/products/customers/
 * stock, and prepare (but never yet use from the UI) tables that can later
 * hold a real offline sale + its outbox entry.
 */

/** V1 offline sales are CASH-only, per the validated audit. */
export type OfflinePaymentMethod = "CASH";

export type SyncStatus =
  | "LOCAL_DRAFT"
  | "PENDING_SYNC"
  | "SYNCING"
  | "SYNCED"
  | "SYNC_ERROR"
  | "REQUIRES_REVIEW";

export type OutboxOperation = "CREATE" | "UPDATE" | "DELETE";

/**
 * One cached snapshot of "who this device is currently logged in as" for
 * the driver POS - a singleton row (see schema.ts's offline_context). Not
 * itself the isolation boundary: every cache/sales/outbox row still carries
 * its own organizationId/driverId and every store function filters on them
 * explicitly, so this row being a singleton never lets one driver's other
 * data leak to a different driver who later logs in on the same device.
 */
export type DriverOfflineContext = {
  organizationId: string;
  organizationName: string | null;
  userId: string;
  userName: string;
  driverId: string;
  driverName: string;
  truckId: string | null;
  truckName: string | null;
  stockLocationId: string | null;
  tourId: string | null;
  tourCode: string | null;
  tourStatus: string | null;
  /** ISO timestamp of the online fetch this cache came from. */
  syncedAt: string;
};

/**
 * Mirrors DriverPosProductDto (types/operations-dto.ts) - only the fields
 * that DTO already carries, nothing invented, plus the isolation keys.
 */
export type CachedProduct = {
  id: string;
  organizationId: string;
  driverId: string;
  reference: string;
  barcode: string | null;
  name: string;
  imageUrl: string | null;
  salePriceHT: number;
  salePriceTTC: number;
  taxRate: number;
  availableQuantity: number;
  supplierId: string | null;
  supplierName: string | null;
  /** PHASE 4A.1 - signed server token attesting salePriceTTC, refreshed on
   *  every online context fetch (see bootstrap.ts). Null only for a cache
   *  written before this column existed - see schema.ts's v3 migration. */
  priceToken: string | null;
  syncedAt: string;
};

/** Mirrors the subset of CustomerDto the driver POS actually needs. */
export type CachedCustomer = {
  id: string;
  organizationId: string;
  driverId: string;
  code: string;
  name: string;
  phone: string | null;
  status: string;
  syncedAt: string;
};

/**
 * One product's truck stock snapshot. `reservedQuantity` is always 0 today
 * (the driver POS has no reservation concept yet) but is modeled now so a
 * later phase doesn't need a schema change. Intentionally no SQLite CHECK
 * keeps quantities >= 0 - truck stock is allowed to go negative, same as
 * the live server rule.
 */
export type CachedTruckStock = {
  productId: string;
  organizationId: string;
  driverId: string;
  truckId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lastSyncedAt: string;
};

export type OfflineSaleLineInput = {
  productId: string;
  /** Product name at the moment of sale - never re-read from the cache later. */
  productNameSnapshot: string;
  quantity: number;
  /** Unit price TTC at the moment of sale. */
  unitPriceSnapshot: number;
  taxRateSnapshot: number;
  /** DH taken off the unit price, snapshotted - 0 in Phase 1 (no offline discount UI). */
  discountSnapshot: number;
  totalHT: number;
  taxAmount: number;
  totalTTC: number;
  /**
   * PHASE 4A.1 - a COPY of cached_products.priceToken, taken at the exact
   * moment of this sale - never re-read from the cache later (see schema.ts's
   * v3 migration doc comment). Null for a sale created before this column
   * existed (a real device may already have a PENDING_SYNC sale like this -
   * see lib/server/driver-sales.ts's "legacy line" fallback for how the
   * server still accepts it) or if the cached product itself had no token.
   */
  priceToken: string | null;
};

export type OfflineSaleInput = {
  /** Client-generated idempotency key for the eventual server sync (mirrors
   *  Sale.idempotencyKey server-side) - unique per attempted offline sale. */
  clientMutationId: string;
  organizationId: string;
  driverId: string;
  truckId: string | null;
  tourId: string | null;
  stockLocationId: string | null;
  customerId: string | null;
  paymentMethod: OfflinePaymentMethod;
  /** ISO timestamp of when the sale was made on-device. */
  soldAt: string;
  subtotalHT: number;
  taxAmount: number;
  totalTTC: number;
  paidAmount: number;
  creditAmount: number;
  lines: OfflineSaleLineInput[];
};

export type OfflineSale = Omit<OfflineSaleInput, "lines"> & {
  localId: string;
  syncStatus: SyncStatus;
  createdAtLocal: string;
  syncedAt: string | null;
  /** Filled in once a later phase actually syncs this sale. */
  serverSaleId: string | null;
  /** The real saleNumber/saleYear-based number, only known post-sync. */
  officialDisplayNumber: string | null;
  syncAttempts: number;
  lastSyncError: string | null;
};

export type OfflineSaleWithLines = OfflineSale & {
  lines: Array<OfflineSaleLineInput & { id: string; offlineSaleId: string }>;
  /**
   * Local-only display reference (e.g. "OFF-20260912-0001") - derived at
   * read time from createdAtLocal + a per-day sequence, never persisted and
   * never a stand-in for a real invoice number (officialDisplayNumber stays
   * null until a future sync actually assigns one - see this type's own
   * comment on that field).
   */
  localReference: string;
};

export type SyncOutboxEntry = {
  id: string;
  entityType: string;
  entityLocalId: string;
  operation: OutboxOperation;
  createdAt: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  lockedAt: string | null;
};
