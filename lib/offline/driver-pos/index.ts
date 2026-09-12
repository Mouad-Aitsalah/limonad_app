"use client";

/**
 * Public API of the offline POS chauffeur cache layer (Phase 1 foundation).
 * React components must go through these functions only - never touch
 * database.ts's SQLiteDBConnection or write raw SQL themselves.
 */

export { hydrateDriverOfflineCache } from "./bootstrap";
export type { HydrateDriverOfflineCacheInput } from "./bootstrap";

export { getDriverOfflineContext, saveDriverOfflineContext } from "./context-store";

export {
  getCachedCustomers,
  getCachedProducts,
  getCachedTruckStock,
  saveCachedCustomers,
  saveCachedProducts,
  saveCachedTruckStock,
} from "./cache-store";

export {
  countPendingOfflineSales,
  createOfflineSale,
  describeOfflineSaleError,
  diagnoseOfflineSalesSchema,
  getOfflineSales,
} from "./sales-store";

export { enqueueSyncOperation, getPendingOutboxEntries } from "./outbox-store";

export { getNetworkState, isNetworkAvailable, isServerReachable } from "./network-status";
export type { NetworkState } from "./network-status";

export { getOfflineDbDiagnostic, isDatabaseAvailable } from "./database";
export type { OfflineDbDiagnostic } from "./database";

export { loadCachedDriverPosContext } from "./pos-context";
export type { CachedDriverPosContext, CachedDriverPosContextResult } from "./pos-context";

export { loadDriverPosContext } from "./pos-data-source";
export type {
  DriverPosCacheCounts,
  DriverPosContextResult,
  DriverPosContextSource,
  LoadDriverPosContextParams,
} from "./pos-data-source";

export type {
  CachedCustomer,
  CachedProduct,
  CachedTruckStock,
  DriverOfflineContext,
  OfflinePaymentMethod,
  OfflineSale,
  OfflineSaleInput,
  OfflineSaleLineInput,
  OfflineSaleWithLines,
  OutboxOperation,
  SyncOutboxEntry,
  SyncStatus,
} from "./types";
