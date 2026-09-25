"use client";

/**
 * COUNTER POS (Admin / Caissier) - LOCAL STORAGE SCHEMA.
 *
 * Phase 2 of the counter-POS offline mode: this module (and its siblings in
 * lib/offline/counter-pos/) is ONLY the local storage layer. Nothing here is
 * wired into components/pos yet, nothing calls the network to sync a sale,
 * and nothing changes how a sale is created online (createCounterSale is the
 * only sale engine and stays untouched).
 *
 * ISOLATION MODEL
 *   - One IndexedDB database PER ORGANIZATION (see database.ts). Another
 *     organization's data is not merely filtered out of a query - it lives in
 *     a different database that is never opened with this organization's id.
 *   - Inside it, every record still carries `organizationId` (defense in
 *     depth; every accessor asserts it matches).
 *   - Catalogue data (products, customers, organization info) is shared by
 *     the users of that organization on this PC: the counter POS shows the
 *     same catalogue to admin / depot_manager / cashier.
 *   - Stock is per stock location (depot), because availableQuantity is.
 *   - Everything that carries an ATTRIBUTION - the authorized-user profile,
 *     the POS context (depot), the cart, and above all the offline sales -
 *     is keyed by userId as well. createCounterSale attributes a sale to the
 *     user of the session that SENDS it (and to that user's depot), so a
 *     sale must never be visible to, or sendable by, another user.
 *
 * SALE STATUSES (a deliberately small state machine, see sales-store.ts):
 *   PENDING  saved locally, not sent yet - or a transient failure waiting for
 *            its next retry (nextAttemptAt)
 *   SYNCING  an attempt is in flight (lockedAt says since when)
 *   SYNCED   the server confirmed it (serverSaleId / officialDisplayNumber)
 *   FAILED   needs a human: the server refused it permanently, or the retry
 *            budget is exhausted. Never retried automatically.
 */

import type { PosBankAccountOptionDto } from "@/types/operations-dto";
import type { UserRole } from "@/types/auth";
import type { PosPaymentMethodValue } from "@/types/pos";

export const COUNTER_POS_DB_PREFIX = "comdis-counter-pos";
export const COUNTER_POS_SCHEMA_VERSION = 1;

/** The default cart slot: the counter POS has one active cart per user today. */
export const DEFAULT_CART_SLOT = "default";

export type CounterPosScope = {
  organizationId: string;
  userId: string;
};

// ---------------------------------------------------------------------------
// Sale statuses
// ---------------------------------------------------------------------------

export const OFFLINE_SALE_STATUSES = ["PENDING", "SYNCING", "SYNCED", "FAILED"] as const;
export type OfflineSaleStatus = (typeof OFFLINE_SALE_STATUSES)[number];

export type OfflinePaymentMethod = PosPaymentMethodValue;

/** A payment row is an INSTRUMENT actually received. CREDIT stores no payment
 *  row (the unpaid part is `creditAmount`); MIXED stores one CASH and one CHECK
 *  row - the same shape createCounterSale persists server-side. */
export type OfflinePaymentInstrument = "CASH" | "CHECK" | "BANK_TRANSFER";

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type MetaRecord = { key: string; value: string | number };

/** A user this PC is authorized to sell for while offline. No secret of any
 *  kind is stored here - the PIN verifier arrives with the offline-auth phase
 *  (a later schema version). */
export type AuthorizedUserRecord = {
  organizationId: string;
  userId: string;
  name: string;
  role: UserRole;
  depotId: string | null;
  stockLocationId: string | null;
  status: "ACTIVE" | "REVOKED";
  enrolledAt: string;
  updatedAt: string;
  lastSeenOnlineAt: string | null;
};

export type OrganizationInfoRecord = {
  organizationId: string;
  name: string;
  tradeName: string | null;
  logoUrl: string | null;
  syncedAt: string;
};

/** The non-catalogue part of CounterPosContextDto, per user (depot differs). */
export type PosContextRecord = {
  organizationId: string;
  userId: string;
  userName: string;
  depot: { id: string; code: string; name: string };
  stockLocation: { id: string; code: string; name: string };
  defaultCustomerId: string | null;
  canSell: boolean;
  message: string | null;
  productsTruncated: boolean;
  bankAccounts: PosBankAccountOptionDto[];
  syncedAt: string;
};

export type ProductRecord = {
  organizationId: string;
  id: string;
  reference: string;
  barcode: string | null;
  name: string;
  imageUrl: string | null;
  salePriceHT: number;
  salePriceTTC: number;
  taxRate: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierLogoUrl: string | null;
  /** Reserved for a future signed-price mechanism; the counter context does
   *  not issue one today, so this is null. */
  priceToken: string | null;
  syncedAt: string;
};

export type StockLevelRecord = {
  organizationId: string;
  stockLocationId: string;
  productId: string;
  /** quantity - reservedQuantity, exactly as getCounterPosContext reports it.
   *  A SERVER value, informational only: never send it back as a stock. */
  availableQuantity: number;
  syncedAt: string;
};

/** Only what the POS needs to pick a customer and show/print a sale. Address,
 *  e-mail, tax ids, notes, GPS and the cached balance are deliberately NOT
 *  stored: the server owns them and the credit ceiling is only ever enforced
 *  server-side. */
export type CustomerRecord = {
  organizationId: string;
  id: string;
  code: string;
  displayCode: string;
  name: string;
  phone: string | null;
  city: string;
  type: string;
  status: string;
  creditLimit: number;
  creditLimitEnabled: boolean;
  syncedAt: string;
};

export type StoredCartLine = {
  productId: string;
  quantity: number;
  /** DH taken off the unit's TTC price (lib/pos-discount.ts). */
  discountUnitAmount: number;
  /** Manual per-line unit price HT (admin only). Absent/null = catalogue price. */
  priceOverrideHT?: number | null;
};

export type CartRecord = {
  organizationId: string;
  userId: string;
  slot: string;
  lines: StoredCartLine[];
  customerId: string | null;
  paymentMethod: OfflinePaymentMethod;
  chequeNumber: string;
  banque: string;
  bankAccountId: string;
  mixedCash: number;
  mixedCheque: number;
  /** Stable for ONE sale attempt: persisted with the cart so a reload can never
   *  mint a second key for the same logical sale. */
  idempotencyKey: string;
  reservedSaleNumber: number | null;
  reservedSaleYear: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncErrorRecord = {
  /** Machine-readable code (see lib/server/offline-sync-errors.ts for the
   *  server's vocabulary) or a local one such as "NETWORK" / "TIMEOUT". */
  code: string;
  message: string;
  /** Whether resending the same sale could ever succeed. */
  retryable: boolean;
  httpStatus: number | null;
  at: string;
};

// ---------------------------------------------------------------------------
// Reference-data synchronization state (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Outcome of the LAST attempt to download the POS reference data:
 *   IDLE     never attempted on this PC
 *   SYNCING  an attempt is running (startedAt says since when)
 *   SUCCESS  the last attempt completed; `lastSyncAt` is that moment
 *   FAILED   the last attempt failed; the previous local data is untouched
 *            and still usable, `lastSyncAt` still points at the last SUCCESS
 */
export type SyncStatus = "IDLE" | "SYNCING" | "SUCCESS" | "FAILED";

export type SyncCounts = {
  /** Records held locally after the sync. */
  total: number;
  added: number;
  updated: number;
  /** Deleted locally because the server no longer lists them (removed or
   *  deactivated). Always 0 when the download was not complete. */
  removed: number;
};

export type SyncSummary = {
  products: SyncCounts;
  customers: SyncCounts;
  stockLevels: number;
  durationMs: number;
  /** "context" = the (<= 500 product) POS context; "catalogue-pages" = the
   *  full active catalogue was paged in because the context was truncated. */
  catalogueSource: "context" | "catalogue-pages";
};

/** A non-fatal problem: the sync succeeded but something was left as it was. */
export type SyncWarning = { code: string; message: string };

export type SyncStateRecord = {
  organizationId: string;
  userId: string;
  status: SyncStatus;
  startedAt: string | null;
  lastAttemptAt: string | null;
  /** Last SUCCESSFUL sync. Never overwritten by a failure. */
  lastSyncAt: string | null;
  lastError: SyncErrorRecord | null;
  warnings: SyncWarning[];
  lastSummary: SyncSummary | null;
  /** True when the last successful sync held the WHOLE active catalogue, so
   *  absent products were safe to delete. */
  catalogueComplete: boolean;
  /** Same, for customers. */
  customersComplete: boolean;
  updatedAt: string;
};

export type OfflineSaleRecord = {
  /** Unique local identifier (UUID). Never reused, never derived from a rank. */
  localId: string;
  organizationId: string;
  userId: string;
  /** The installation (per organization database) that made the sale. */
  deviceId: string;
  depotId: string | null;
  stockLocationId: string;
  customerId: string | null;
  /** Ticket snapshot - never re-read from the customer cache later. */
  customerCode: string | null;
  customerName: string | null;
  paymentMethod: OfflinePaymentMethod;
  reference: string | null;
  bankAccountingAccountId: string | null;
  subtotalHT: number;
  discountAmount: number;
  taxAmount: number;
  totalTTC: number;
  paidAmount: number;
  creditAmount: number;
  /** Unique per organization (IndexedDB unique index): the same value is sent
   *  to createCounterSale as idempotencyKey on every attempt. */
  idempotencyKey: string;
  reservedSaleNumber: number | null;
  reservedSaleYear: number | null;
  /** Display-only provisional reference ("OFF-<device>-<YYYYMMDD>-<NNNN>"),
   *  from a persisted per-device counter. NOT an invoice number. */
  localReference: string;
  /** When the sale really happened on this device (ISO). */
  soldAt: string;
  createdAtLocal: string;
  updatedAtLocal: string;
  status: OfflineSaleStatus;
  syncAttempts: number;
  lastAttemptAt: string | null;
  /** Earliest time the next automatic attempt may start (transient failures). */
  nextAttemptAt: string | null;
  /** Set while SYNCING, to detect an attempt interrupted by a crash/restart. */
  lockedAt: string | null;
  lastError: SyncErrorRecord | null;
  serverSaleId: string | null;
  officialDisplayNumber: string | null;
  syncedAt: string | null;
  serverTotalTTC: number | null;
  totalMismatch: boolean;
};

export type OfflineSaleLineRecord = {
  id: string;
  localId: string;
  organizationId: string;
  /** Stable display order within the sale. */
  position: number;
  productId: string;
  productReference: string;
  productName: string;
  quantity: number;
  unitPriceHT: number;
  taxRate: number;
  discountUnitAmount: number;
  priceOverridden: boolean;
  discountAmount: number;
  totalHT: number;
  taxAmount: number;
  totalTTC: number;
};

export type OfflineSalePaymentRecord = {
  id: string;
  localId: string;
  organizationId: string;
  position: number;
  method: OfflinePaymentInstrument;
  amount: number;
  reference: string | null;
};

export type OfflineSaleWithDetails = OfflineSaleRecord & {
  lines: OfflineSaleLineRecord[];
  payments: OfflineSalePaymentRecord[];
};

// ---------------------------------------------------------------------------
// Dexie store definitions (schema version 1)
// ---------------------------------------------------------------------------

/**
 * Dexie "stores" spec. Compound primary keys are written `[a+b]`; `&` marks a
 * UNIQUE index. Only fields that are actually queried are indexed.
 *
 * Shipped versions must never be edited: a change goes in a NEW
 * `db.version(n)` in database.ts, with an upgrade function if data moves.
 */
export const COUNTER_POS_STORES = {
  meta: "key",
  authorizedUsers: "[organizationId+userId], organizationId",
  organizationInfo: "organizationId",
  posContexts: "[organizationId+userId]",
  products: "[organizationId+id], organizationId",
  stockLevels: "[organizationId+stockLocationId+productId], [organizationId+stockLocationId]",
  customers: "[organizationId+id], organizationId",
  carts: "[organizationId+userId+slot], [organizationId+userId]",
  // [org+location+status] serves the "quantity still to be decremented per
  // product" aggregate, which spans every user of the depot on this PC.
  offlineSales:
    "localId, &idempotencyKey, [organizationId+userId+status], [organizationId+userId+soldAt], [organizationId+stockLocationId+status]",
  offlineSaleLines: "id, localId",
  offlineSalePayments: "id, localId",
  // Added in Phase 3, still schema version 1: nothing had shipped or even
  // opened this database yet (the layer was not wired anywhere), so there is
  // no installed v1 to migrate. From the first release on, changes need a
  // new version.
  syncStates: "[organizationId+userId]",
} as const;

// ---------------------------------------------------------------------------
// Store errors
// ---------------------------------------------------------------------------

export type StoreErrorCode =
  | "INDEXEDDB_UNAVAILABLE"
  | "INVALID_INPUT"
  | "SCOPE_MISMATCH"
  | "DUPLICATE_IDEMPOTENCY_KEY"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "QUOTA_EXCEEDED"
  | "STORAGE_ERROR";

/** Every storage function fails SOFT: it resolves to this, never rejects, so a
 *  broken/unavailable IndexedDB can never crash the POS (same contract the
 *  driver layer has). */
export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: StoreErrorCode; message: string };
