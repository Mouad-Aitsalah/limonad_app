"use client";

/**
 * COUNTER POS offline - public surface of the local storage layer (Phase 2).
 * Storage only: nothing here is used by components/pos yet.
 */

export * from "./schema";
export {
  closeAllCounterPosDatabases,
  closeCounterPosDatabase,
  counterPosDatabaseName,
  deleteCounterPosDatabase,
  generateUuid,
  getDeviceId,
  getCounterPosDatabase,
  isIndexedDbAvailable,
} from "./database";
export {
  getNetworkState,
  isDeviceOnline,
  isServerReachable,
  subscribeToNetworkState,
  type NetworkState,
} from "./network-status";
export {
  getAuthorizedUser,
  getOrganizationInfo,
  listAuthorizedUsers,
  revokeAuthorizedUser,
  saveOrganizationInfo,
  upsertAuthorizedUser,
} from "./profile-store";
export {
  applyPendingSalesToContext,
  hydrateCounterPosSnapshot,
  loadCachedCounterPosContext,
  loadCounterPosContext,
  type CounterPosContextResult,
} from "./pos-data-source";
export {
  isPosSyncRunning,
  startPosDataAutoSync,
  syncPosData,
  type PosAutoSyncOptions,
  type SyncFailureCode,
  type SyncPosDataDeps,
  type SyncPosDataResult,
} from "./pos-sync";
export {
  effectiveSyncStatus,
  getPosSyncState,
  SYNC_STALE_RUNNING_MS,
} from "./sync-state-store";
export {
  startCounterSalesAutoSync,
  type CounterSalesAutoSync,
  type SalesSyncStatus,
  type SyncTrigger,
} from "./sales-sync-controller";
export {
  buildCounterSyncPayload,
  isCounterSalesSyncRunning,
  syncOfflineCounterSales,
  type CounterSyncPayload,
  type SaleSyncOutcome,
  type SyncSalesDeps,
  type SyncSalesResult,
} from "./sales-sync";
export {
  claimSaleForSync,
  computeRetryDelayMs,
  countOfflineSalesByStatus,
  createOfflineSale,
  deleteCart,
  findOfflineSaleByIdempotencyKey,
  getOfflineSale,
  getPendingQuantityByProduct,
  listOfflineSales,
  loadCart,
  markSaleSynced,
  markSaleSyncFailure,
  pruneSyncedSales,
  reapStaleSyncingSales,
  requeueFailedSale,
  revertSaleToPending,
  saveCart,
  SYNC_MAX_ATTEMPTS,
  validateOfflineSaleInput,
  type OfflineSaleInput,
} from "./sales-store";
export {
  clearOfflineSession,
  closeOfflineSessionDatabase,
  markOfflineDataReady,
  OFFLINE_SESSION_TTL_MS,
  offlineSessionToCurrentUser,
  peekOfflineSessionOrganizationId,
  readOfflineSession,
  saveOfflineSession,
  type OfflineSession,
  type ReadOfflineSessionResult,
} from "./offline-session";
export {
  resolveOfflineStartup,
  type OfflineStartupResult,
} from "./offline-startup";
export { cleanupOnLogout, purgeReferenceData, type LogoutCleanupResult } from "./offline-logout";
export { registerOfflineServiceWorker, OFFLINE_SHELL_PATH } from "./service-worker";
