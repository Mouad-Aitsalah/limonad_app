"use client";

import * as React from "react";

import type { FleetTruckDto } from "@/types/fleet-tracking";

/**
 * Admin's "C. monitoring" polling loop - reads what the driver side already
 * wrote (TourLocationPing, via /api/trucks/live -> getFleetSnapshot). Never
 * captures or sends GPS itself; this is a read-only client for the one GPS
 * flow that already exists.
 *
 * Polling, not SSE/WebSocket: the project has no existing real-time
 * transport, tour counts per organization are small, and a plain 7s
 * fetch loop is the simplest thing that satisfies "positions every ~30s,
 * admin refresh every 5-10s" without standing up new infrastructure.
 */
const FLEET_POLL_INTERVAL_MS = 7_000;

export function useFleetTracking() {
  const [trucks, setTrucks] = React.useState<FleetTruckDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);
  // Guards against overlapping polls if a request is unusually slow.
  const fetchingRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const response = await fetch("/api/trucks/live", { cache: "no-store" });
      const payload = (await response.json()) as {
        trucks?: FleetTruckDto[];
        message?: string;
      };

      if (!response.ok || !payload.trucks) {
        throw new Error(payload.message ?? "Impossible de charger le suivi GPS en direct.");
      }

      if (mountedRef.current) {
        setTrucks(payload.trucks);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Impossible de charger le suivi GPS en direct.");
      }
    } finally {
      fetchingRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;

    // Deferred (not called directly in the effect body) so the initial
    // fetch's eventual setState is unambiguously a reaction to an external
    // event (the timer firing), not something that could run during the
    // commit itself.
    const initialFetchId = window.setTimeout(() => void refresh(), 0);
    const intervalId = window.setInterval(() => void refresh(), FLEET_POLL_INTERVAL_MS);

    // Also refresh when the admin comes back to the tab, so a
    // long-backgrounded browser doesn't keep showing a stale snapshot for
    // up to a full poll interval.
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(initialFetchId);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  return { trucks, loading, error, refresh };
}
