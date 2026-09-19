import * as React from "react";

import { useDriverGeolocation, type DriverGpsPosition } from "@/hooks/use-driver-geolocation";
import { DriverRuntimeContext } from "@/hooks/use-driver-runtime";
import type { CurrentDriverTourDto } from "@/types/operations-dto";

import { sendGpsPoint } from "./driver-gps-sender";
import { GpsSyncPill } from "./gps-sync-pill";
import { mobileFetch } from "./mobile-fetch";

type RuntimeValue = NonNullable<React.ContextType<typeof DriverRuntimeContext>>;

/**
 * ÉTAPE 28B/28E - the shell's stand-in for the historical DriverRuntimeProvider
 * (hooks/use-driver-runtime.tsx), providing the very same DriverRuntimeContext
 * that module already exports for exactly this purpose - DriverTourView keeps
 * calling useDriverRuntime() unchanged.
 *
 * ÉTAPE 28E - FOREGROUND, ONLINE-ONLY GPS. The GPS is the historical
 * useDriverGeolocation hook itself (navigator.geolocation in the Capacitor
 * WebView - the bridge asks Android for the location permission, declared by
 * the already-installed location plugin's manifest), not a parallel system:
 * permission / denied / GPS off / timeout / accuracy / status classification all
 * come from it. It only runs while the tour is IN_PROGRESS AND this screen is
 * mounted - closing the app or leaving the screen stops it (no background GPS).
 *
 * Sending: every reliable fix the hook releases (already throttled to one per
 * >=15 s or >=20 m, lib/gps/gps-config.ts) is POSTed to /location/batch over
 * Bearer (driver-gps-sender.ts). Offline, the watch keeps running (status stays
 * live) but nothing is sent AND nothing is stored: the fix is dropped - the
 * offline GPS queue is a later étape. One request in flight at a time.
 *
 * Still not the historical provider: no customer proximity feed, no native
 * background tracker, no GPS queue flush - each is a later étape.
 */
export type GpsSyncState = "IDLE" | "SENDING" | "SYNCED" | "OFFLINE" | "ERROR" | "REJECTED" | "UNAUTHORIZED";

const DEV_LOG = import.meta.env.DEV;

export function DriverTourRuntimeProvider({
  token,
  deviceOnline,
  children,
}: {
  token: string | null;
  deviceOnline: boolean;
  children: React.ReactNode;
}) {
  const [currentTour, setCurrentTour] = React.useState<CurrentDriverTourDto | null>(null);
  const [syncState, setSyncState] = React.useState<GpsSyncState>("IDLE");

  const setTour = React.useCallback((tour: CurrentDriverTourDto) => setCurrentTour(tour), []);

  const refreshCurrentTour = React.useCallback(async () => {
    const outcome = await mobileFetch<{ currentTour?: CurrentDriverTourDto }>("/api/driver/tour", token);
    if (outcome.kind !== "ok" || !outcome.data?.currentTour) {
      throw new Error("Impossible de charger la tournee chauffeur.");
    }
    setCurrentTour(outcome.data.currentTour);
    return outcome.data.currentTour;
  }, [token]);

  // Latest values for the (stable) GPS callback below.
  const tokenRef = React.useRef(token);
  const onlineRef = React.useRef(deviceOnline);
  const tourIdRef = React.useRef<string | null>(null);
  const sendingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const tourId = currentTour?.tour?.id ?? null;
  React.useEffect(() => {
    tokenRef.current = token;
    onlineRef.current = deviceOnline;
    tourIdRef.current = tourId;
  }, [token, deviceOnline, tourId]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleReliablePosition = React.useCallback(async (position: DriverGpsPosition) => {
    const activeTourId = tourIdRef.current;
    if (!activeTourId) return;
    // Dev logs carry position + state only - never the token.
    if (DEV_LOG) {
      console.info("[gps] fix", position.latitude, position.longitude, position.recordedAt, `acc=${position.accuracy ?? "?"}`, `online=${onlineRef.current}`);
    }
    if (!onlineRef.current) {
      setSyncState("OFFLINE");
      return;
    }
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSyncState("SENDING");
    try {
      const outcome = await sendGpsPoint({ token: tokenRef.current, tourId: activeTourId, position });
      if (DEV_LOG) console.info("[gps] send", outcome.kind);
      if (!mountedRef.current) return;
      setSyncState(
        outcome.kind === "synced"
          ? "SYNCED"
          : outcome.kind === "offline"
            ? "OFFLINE"
            : outcome.kind === "unauthorized"
              ? "UNAUTHORIZED"
              : outcome.kind === "rejected"
                ? "REJECTED"
                : "ERROR",
      );
    } finally {
      sendingRef.current = false;
    }
  }, []);

  const isTourInProgress = currentTour?.tour?.status === "IN_PROGRESS";
  const gps = useDriverGeolocation({
    active: isTourInProgress,
    initialPosition: null,
    onReliablePosition: handleReliablePosition,
  });

  const value = React.useMemo<RuntimeValue>(
    () => ({
      customers: [],
      currentTour,
      gps,
      nearbyCustomer: null,
      dismissNearbyCustomer: () => undefined,
      markCustomerHandled: () => undefined,
      upsertCustomer: () => undefined,
      refreshCustomers: async () => [],
      refreshCurrentTour,
      refreshRuntime: async () => {
        await refreshCurrentTour().catch(() => undefined);
      },
      hydrateCurrentTour: setTour,
      replaceCurrentTour: setTour,
    }),
    [currentTour, gps, refreshCurrentTour, setTour],
  );

  return (
    <DriverRuntimeContext.Provider value={value}>
      {children}
      {isTourInProgress ? <GpsSyncPill state={syncState} deviceOnline={deviceOnline} /> : null}
    </DriverRuntimeContext.Provider>
  );
}
