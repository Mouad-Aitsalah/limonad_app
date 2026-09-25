"use client";

import * as React from "react";

import {
  countOfflineSalesByStatus,
  hydrateCounterPosSnapshot,
  loadCachedCounterPosContext,
  markOfflineDataReady,
  registerOfflineServiceWorker,
  saveOfflineSession,
  startPosDataAutoSync,
  startCounterSalesAutoSync,
  subscribeToNetworkState,
  type CounterPosScope,
  type CounterSalesAutoSync,
  type NetworkState,
  type SalesSyncStatus,
  type SyncSalesResult,
} from "@/lib/offline/counter-pos";
import { useAuth } from "@/hooks/use-auth";
import type { CounterPosContextDto } from "@/types/operations-dto";

export type CounterPosOfflineState = {
  /** Null until the signed-in user is known (nothing local can be used then). */
  scope: CounterPosScope | null;
  networkState: NetworkState;
  /** True whenever the server cannot be reached: no network OR server down. */
  isOffline: boolean;
  /** Sales saved on this PC and not yet confirmed by the server (pending + in error). */
  unsyncedCount: number;
  /** Waiting to be sent (PENDING or being sent). */
  pendingCount: number;
  /** Rejected or out of retries: need a look, never retried by themselves. */
  failedCount: number;
  refreshUnsyncedCount: () => Promise<void>;
  /** Phase 7: synchronisation state and the "Synchroniser maintenant" action. */
  syncStatus: SalesSyncStatus;
  syncNow: () => Promise<SyncSalesResult | null>;
  /** The locally mirrored context (stock already net of pending sales), or null. */
  loadLocalContext: () => Promise<CounterPosContextDto | null>;
};

/**
 * Phase 4 - the counter POS's view of "am I online, and what do I have
 * locally". Purely additive: while ONLINE the POS keeps using its API exactly
 * as before; this hook only (1) mirrors the fresh server context into
 * IndexedDB, (2) keeps that mirror up to date, and (3) tells the POS when to
 * switch to the local source.
 */
export function useCounterPosOffline(
  initialContext: CounterPosContextDto,
  options: {
    onSalesSynced?: () => void;
    /** Offline shell (/hors-ligne): the context IS the local mirror - never
     *  write it back (it would fake a fresh server snapshot) and do not
     *  register the service worker from here. */
    shell?: boolean;
  } = {},
): CounterPosOfflineState {
  const onSalesSyncedRef = React.useRef(options.onSalesSynced);
  React.useEffect(() => {
    onSalesSyncedRef.current = options.onSalesSynced;
  }, [options.onSalesSynced]);

  const { currentUser } = useAuth();
  const organizationId = currentUser?.organizationId ?? null;
  const userId = currentUser?.id ?? null;
  const scope = React.useMemo<CounterPosScope | null>(
    () => (organizationId && userId ? { organizationId, userId } : null),
    [organizationId, userId],
  );

  // Starting without Internet must not begin as "ONLINE" (the POS would try
  // the server first): trust the browser's own signal until the probe answers.
  const shell = options.shell === true;
  const [networkState, setNetworkState] = React.useState<NetworkState>(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "OFFLINE";
    // The offline shell only opens the POS after finding the server unreachable.
    return shell ? "SERVER_UNREACHABLE" : "ONLINE";
  });
  const currentUserRef = React.useRef(currentUser);
  React.useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  const [counts, setCounts] = React.useState({ pending: 0, failed: 0 });
  const [syncStatus, setSyncStatus] = React.useState<SalesSyncStatus>({ running: false, lastRun: null });
  const controllerRef = React.useRef<CounterSalesAutoSync | null>(null);
  // One network probe feeds both the POS state and the sync controller.
  const networkListenersRef = React.useRef(new Set<(state: NetworkState) => void>());
  const latestNetworkRef = React.useRef<NetworkState | null>(null);

  const refreshUnsyncedCount = React.useCallback(async () => {
    if (!scope) return;
    const result = await countOfflineSalesByStatus(scope);
    if (result.ok) {
      setCounts({
        pending: result.value.PENDING + result.value.SYNCING,
        failed: result.value.FAILED,
      });
    }
  }, [scope]);

  React.useEffect(() => {
    const listeners = networkListenersRef.current;
    const stop = subscribeToNetworkState((state) => {
      latestNetworkRef.current = state;
      setNetworkState(state);
      for (const listener of listeners) listener(state);
    });
    return () => {
      stop();
      listeners.clear();
    };
  }, []);

  // Mirror the server-rendered context (fresh by construction), then keep the
  // mirror current while online. Failures are logged by the layer and never
  // block the POS.
  React.useEffect(() => {
    if (!scope) return;
    if (shell) {
      void Promise.resolve().then(() => refreshUnsyncedCount());
      return;
    }
    let stopAutoSync: (() => void) | null = null;
    let cancelled = false;
    void hydrateCounterPosSnapshot(scope, initialContext).then(async (hydrated) => {
      if (cancelled) return;
      // The server just confirmed this session AND the POS data is mirrored:
      // (re)initialise the offline session so the next start can work offline.
      const user = currentUserRef.current;
      if (hydrated.ok && user) {
        const saved = await saveOfflineSession(user);
        if (saved.ok) await markOfflineDataReady(scope);
        // Offline start-up support: the service worker keeps the app shell.
        registerOfflineServiceWorker();
      }
      stopAutoSync = startPosDataAutoSync(scope);
      await refreshUnsyncedCount();
    });
    return () => {
      cancelled = true;
      stopAutoSync?.();
    };
    // initialContext is the SSR snapshot, mirrored once per scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, shell]);

  // Keep the offline session alive while the server keeps confirming the user
  // (the client state comes from /api/auth/session, re-checked every 30 min;
  // a definitive "no session" clears it in AuthProvider).
  React.useEffect(() => {
    if (shell || !scope || networkState !== "ONLINE") return;
    const renew = async () => {
      const user = currentUserRef.current;
      if (!user) return;
      await saveOfflineSession(user);
    };
    const timer = window.setInterval(() => void renew(), 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [shell, scope, networkState]);

  // Phases 5/7: synchronise the pending sales on reconnection (OFFLINE ->
  // ONLINE), at start-up, periodically for the ones whose backoff elapsed, and
  // on demand. One controller per user; it never runs two syncs at once.
  React.useEffect(() => {
    if (!scope) return;
    const listeners = networkListenersRef.current;
    let stopped = false;
    let previous = false;
    const controller = startCounterSalesAutoSync(scope, {
      subscribe: (listener) => {
        listeners.add(listener);
        if (latestNetworkRef.current) listener(latestNetworkRef.current);
        return () => listeners.delete(listener);
      },
      onStatus: (status) => {
        if (stopped) return;
        setSyncStatus(status);
        // A run just ended: recount, and re-read the stock if sales landed.
        if (previous && !status.running) {
          void refreshUnsyncedCount();
          if ((status.lastRun?.result.synced ?? 0) > 0) onSalesSyncedRef.current?.();
        }
        previous = status.running;
      },
    });
    controllerRef.current = controller;
    return () => {
      stopped = true;
      controller.stop();
      controllerRef.current = null;
    };
  }, [scope, refreshUnsyncedCount]);

  const syncNow = React.useCallback(async () => {
    return controllerRef.current ? controllerRef.current.syncNow() : null;
  }, []);

  const loadLocalContext = React.useCallback(async () => {
    if (!scope) return null;
    const cached = await loadCachedCounterPosContext(scope);
    return cached.ok ? cached.context : null;
  }, [scope]);

  return {
    scope,
    networkState,
    isOffline: networkState !== "ONLINE",
    unsyncedCount: counts.pending + counts.failed,
    pendingCount: counts.pending,
    failedCount: counts.failed,
    refreshUnsyncedCount,
    syncStatus,
    syncNow,
    loadLocalContext,
  };
}
