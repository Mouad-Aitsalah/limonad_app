"use client";

import * as React from "react";

import { getNetworkState, type NetworkState } from "@/lib/offline/driver-pos/network-status";

const CHECK_INTERVAL_MS = 30000;

/**
 * Shared, polled network state - the single source both NetworkStatusBadge
 * and driver-pos-view.tsx react to, so they can never disagree about
 * whether the app is currently online (see lib/offline/driver-pos/
 * network-status.ts for what ONLINE/OFFLINE/SERVER_UNREACHABLE actually
 * check). No retry engine - just a periodic re-check plus the browser's own
 * online/offline events for a snappier reaction to an obvious change.
 */
export function useNetworkState(): NetworkState {
  const [state, setState] = React.useState<NetworkState>("ONLINE");

  React.useEffect(() => {
    let active = true;

    async function check() {
      const next = await getNetworkState();
      if (active) setState(next);
    }

    void check();
    const onOnline = () => void check();
    const onOffline = () => setState("OFFLINE");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, []);

  return state;
}
