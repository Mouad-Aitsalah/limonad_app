"use client";

import { Wifi, WifiOff } from "lucide-react";

import { useNetworkState } from "@/hooks/use-network-status";
import type { NetworkState } from "@/lib/offline/driver-pos/network-status";

const LABELS: Record<NetworkState, string> = {
  ONLINE: "Connecté",
  OFFLINE: "Hors connexion",
  SERVER_UNREACHABLE: "Hors connexion",
};

/**
 * Small, non-intrusive online/offline pill for the driver POS header.
 *
 * Display only - it never gates, disables, or unlocks any validation path
 * by itself (see driver-pos-view.tsx for the actual offline guards on
 * Encaisser/Préparer/Encaisser-en-attente). This just renders the shared
 * useNetworkState() hook's current value.
 */
export function NetworkStatusBadge() {
  const state = useNetworkState();
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
