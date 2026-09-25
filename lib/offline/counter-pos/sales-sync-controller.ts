"use client";

/**
 * COUNTER POS - when to synchronise (Phase 7). sales-sync.ts knows HOW to send
 * the pending sales; this decides WHEN:
 *
 *   - RECONNECT  the network state becomes ONLINE (OFFLINE / SERVER_UNREACHABLE
 *                -> ONLINE), and once at start-up if already ONLINE;
 *   - INTERVAL   every `intervalMs` while ONLINE, so a sale whose backoff has
 *                elapsed (server was down) is retried without any user action;
 *   - MANUAL     syncNow(): works whatever the network state says and skips
 *                the backoff wait - the user asked, so try now.
 *
 * Never two runs at once: this controller shares one in-flight promise, and
 * the engine underneath refuses overlaps (in-process guard + Web Lock), so
 * two tabs cannot double-send either. A failed run never loses a sale: they
 * stay PENDING with a backoff (or FAILED with the precise message).
 */

import { subscribeToNetworkState, type NetworkState } from "./network-status";
import type { CounterPosScope } from "./schema";
import { syncOfflineCounterSales, type SyncSalesDeps, type SyncSalesResult } from "./sales-sync";

export type SyncTrigger = "STARTUP" | "RECONNECT" | "INTERVAL" | "MANUAL";

export type SalesSyncStatus = {
  running: boolean;
  lastRun: { at: string; trigger: SyncTrigger; result: SyncSalesResult } | null;
};

export type CounterSalesAutoSyncOptions = {
  intervalMs?: number;
  now?: () => Date;
  subscribe?: (listener: (state: NetworkState) => void) => () => void;
  sync?: (scope: CounterPosScope, deps?: SyncSalesDeps) => Promise<SyncSalesResult>;
  syncDeps?: SyncSalesDeps;
  onStatus?: (status: SalesSyncStatus) => void;
};

export type CounterSalesAutoSync = {
  stop: () => void;
  /** Synchronise now, ignoring the network state and the backoff. Never overlaps a run. */
  syncNow: () => Promise<SyncSalesResult>;
  getStatus: () => SalesSyncStatus;
};

export function startCounterSalesAutoSync(
  scope: CounterPosScope,
  options: CounterSalesAutoSyncOptions = {},
): CounterSalesAutoSync {
  const intervalMs = options.intervalMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  const subscribe = options.subscribe ?? ((listener) => subscribeToNetworkState(listener));
  const sync = options.sync ?? syncOfflineCounterSales;

  let stopped = false;
  let networkState: NetworkState | null = null;
  let inFlight: Promise<SyncSalesResult> | null = null;
  let status: SalesSyncStatus = { running: false, lastRun: null };

  function publish(next: SalesSyncStatus) {
    status = next;
    if (!stopped) options.onStatus?.(status);
  }

  function run(trigger: SyncTrigger): Promise<SyncSalesResult> {
    if (inFlight) return inFlight;
    publish({ ...status, running: true });
    const current = (async () => {
      let result: SyncSalesResult;
      try {
        result = await sync(scope, {
          ...options.syncDeps,
          ignoreBackoff: trigger === "MANUAL" ? true : options.syncDeps?.ignoreBackoff,
        });
      } catch {
        // The engine reports failures as results; this is a bug guard only.
        result = { status: "STOPPED_SERVER", attempted: 0, synced: 0, failed: 0, retryLater: 0, outcomes: [] };
      }
      // A run that found nothing to do must not erase the last useful summary.
      const keep = result.status === "NOTHING_TO_SYNC" || result.status === "ALREADY_RUNNING";
      publish({
        running: false,
        lastRun: keep && status.lastRun ? status.lastRun : { at: now().toISOString(), trigger, result },
      });
      return result;
    })().finally(() => {
      inFlight = null;
    });
    inFlight = current;
    return current;
  }

  const unsubscribe = subscribe((state) => {
    const wasOnline = networkState === "ONLINE";
    const first = networkState === null;
    networkState = state;
    if (state === "ONLINE" && !wasOnline) void run(first ? "STARTUP" : "RECONNECT");
  });

  const timer =
    intervalMs > 0
      ? setInterval(() => {
          if (networkState === "ONLINE") void run("INTERVAL");
        }, intervalMs)
      : null;

  return {
    stop() {
      stopped = true;
      unsubscribe();
      if (timer) clearInterval(timer);
    },
    syncNow: () => run("MANUAL"),
    getStatus: () => status,
  };
}
