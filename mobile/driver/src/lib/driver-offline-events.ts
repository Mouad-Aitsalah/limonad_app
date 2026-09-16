export const DRIVER_OFFLINE_SYNC_COMPLETED_EVENT = "driver-offline-sync-completed";

export type DriverOfflineSyncCompletedDetail = {
  syncedCount: number;
  failedCount: number;
};

/**
 * BUG-02 "RAFRAÎCHIR L'UI APRÈS SYNCHRONISATION AUTOMATIQUE" - a single,
 * lightweight `window` CustomEvent dispatched once a sync batch (manual OR
 * automatic - both go through the same syncPendingDriverSalesForShell, see
 * driver-pos-data-source.ts) finishes, so any currently-mounted screen can
 * react and refresh its own LOCAL (SQLite-only, no network) view of
 * offline_sales - no polling, no full app reboot.
 *
 * Deliberately NOT dispatched from the shared sync engine itself
 * (lib/offline/driver-pos/sync-sales.ts) - that module is shared with the
 * web app and stays completely unmodified; this is a shell-only UI concern
 * layered on top of its own result, after the existing single-flight engine
 * has already finished (see syncPendingDriverSalesForShell).
 */
export function dispatchDriverOfflineSyncCompleted(detail: DriverOfflineSyncCompletedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DriverOfflineSyncCompletedDetail>(DRIVER_OFFLINE_SYNC_COMPLETED_EVENT, { detail }),
  );
}

/**
 * Subscribes to the event above; returns an unsubscribe function - call from
 * a React effect's own cleanup, same pattern as any other DOM listener.
 */
export function onDriverOfflineSyncCompleted(
  handler: (detail: DriverOfflineSyncCompletedDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    handler((event as CustomEvent<DriverOfflineSyncCompletedDetail>).detail);
  };
  window.addEventListener(DRIVER_OFFLINE_SYNC_COMPLETED_EVENT, listener);
  return () => window.removeEventListener(DRIVER_OFFLINE_SYNC_COMPLETED_EVENT, listener);
}
