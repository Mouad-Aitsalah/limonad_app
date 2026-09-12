"use client";

import * as React from "react";
import { Wifi, WifiOff } from "lucide-react";

import { getNetworkState, type NetworkState } from "@/lib/offline/driver-pos/network-status";

const LABELS: Record<NetworkState, string> = {
  ONLINE: "Connecté",
  OFFLINE: "Hors connexion",
  SERVER_UNREACHABLE: "Hors connexion",
};

const CHECK_INTERVAL_MS = 30000;

/**
 * Small, non-intrusive online/offline pill for the driver POS header.
 *
 * Phase 1 scope: display only. It never gates, disables, or unlocks any
 * validation path - the POS still requires a real server round-trip for
 * every sale, exactly as before. This just tells the driver what the app
 * already knows via lib/offline/driver-pos/network-status.ts.
 */
export function NetworkStatusBadge() {
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

  const isOnline = state === "ONLINE";

  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium " +
        (isOnline
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700")
      }
    >
      {isOnline ? (
        <Wifi aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {LABELS[state]}
    </span>
  );
}
