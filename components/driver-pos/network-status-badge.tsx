"use client";

import { Wifi, WifiOff } from "lucide-react";

import { useNetworkState } from "@/hooks/use-network-status";
import type { NetworkState } from "@/lib/offline/driver-pos/network-status";

const LABELS: Record<NetworkState, string> = {
  ONLINE: "Connecté",
  OFFLINE: "Hors connexion",
  SERVER_UNREACHABLE: "Hors connexion",
};

type NetworkStatusBadgeProps = {
  /**
   * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 2: optional override for
   * a caller that already computes its own network state and doesn't have
   * (or want) the cookie-authenticated `/api/auth/session` probe
   * `useNetworkState()` itself relies on - the Android shell, whose own
   * `effectiveOnline` is already corrected from real Bearer-authenticated
   * fetch outcomes (see mobile/driver's PosScreen.tsx). When omitted
   * (every existing web call site), behavior is byte-for-byte unchanged:
   * this component still renders the shared useNetworkState() hook's live
   * value, exactly as before this prop existed.
   */
  networkState?: NetworkState;
};

/**
 * Small, non-intrusive online/offline pill for the driver POS header.
 *
 * Display only - it never gates, disables, or unlocks any validation path
 * by itself (see driver-pos-view.tsx for the actual offline guards on
 * Encaisser/Préparer/Encaisser-en-attente). This just renders the shared
 * useNetworkState() hook's current value, unless a caller overrides it via
 * the `networkState` prop (see that prop's own doc comment).
 */
export function NetworkStatusBadge({ networkState }: NetworkStatusBadgeProps = {}) {
  // Rules of Hooks: this hook is called unconditionally on every render,
  // exactly as before - only WHICH value gets used below depends on the
  // prop, never whether the hook itself runs. A caller that always passes
  // `networkState` (the shell) still pays for this hook's own effect/probe
  // running in the background; its result is simply never read then.
  const liveNetworkState = useNetworkState();
  const state = networkState ?? liveNetworkState;
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
