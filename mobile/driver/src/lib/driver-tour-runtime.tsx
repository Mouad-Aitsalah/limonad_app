import * as React from "react";
import { Capacitor } from "@capacitor/core";

import { useDriverGeolocation, type DriverGpsPosition } from "@/hooks/use-driver-geolocation";
import { DriverRuntimeContext, mergeCustomerIntoCurrentTour } from "@/hooks/use-driver-runtime";
import { enqueueGpsPoint } from "@/lib/gps/gps-offline-queue";
import { deriveClientPingId } from "@/lib/gps/gps-utils";
import type { CurrentDriverTourDto, CustomerDto } from "@/types/operations-dto";

import { sendGpsPoint } from "./driver-gps-sender";
import { useDriverGpsRuntimeStatus } from "./driver-gps-status-context";
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
 * This foreground watch feeds the on-screen map/proximity feature; it stays
 * tour-scoped on purpose (a map with no tour has nothing to show).
 *
 * Sending: every reliable fix the hook releases (already throttled to one per
 * >=15 s or >=20 m, lib/gps/gps-config.ts) is POSTed to /location/batch over
 * Bearer (driver-gps-sender.ts). Offline, the watch keeps running (status stays
 * live) but the fix is queued locally (lib/gps/gps-offline-queue.ts) instead of
 * sent, and flushed once back online.
 *
 * NEW RULE (GPS/tournee/chargement independence) - the GPS *badge* shown by
 * DriverTourHeader must NOT be read from this tour-scoped foreground watch
 * alone: on native platforms the real tracker is the App-level, clock-driven
 * DriverGpsRuntime (driver-gps-runtime.tsx), which runs independently of any
 * tour. `gps.status` exposed below is therefore overridden with that real
 * background status on native platforms (see useDriverGpsRuntimeStatus),
 * keeping this hook's own richer position/permission fields untouched for
 * whatever still legitimately depends on the foreground watch itself.
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

  // A customer created from the map's quick-add modal must show up on the tour
  // map right away: same merge the web runtime applies (markers + selection).
  const upsertCustomer = React.useCallback((customer: CustomerDto) => {
    setCurrentTour((previous) => (previous ? mergeCustomerIntoCurrentTour(previous, customer) : previous));
  }, []);

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
      const capturedAtMs = Date.parse(position.recordedAt);
      void enqueueGpsPoint({
        tourId: activeTourId,
        clientPingId: deriveClientPingId("n", capturedAtMs, position.latitude, position.longitude),
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: position.speed,
        heading: position.heading,
        capturedAt: position.recordedAt,
      });
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
  const foregroundGps = useDriverGeolocation({
    active: isTourInProgress,
    initialPosition: null,
    onReliablePosition: handleReliablePosition,
  });
  const nativeGpsStatus = useDriverGpsRuntimeStatus();
  const gps = React.useMemo(
    () => (Capacitor.isNativePlatform() ? { ...foregroundGps, status: nativeGpsStatus } : foregroundGps),
    [foregroundGps, nativeGpsStatus],
  );

  const value = React.useMemo<RuntimeValue>(
    () => ({
      customers: [],
      currentTour,
      gps,
      nearbyCustomer: null,
      dismissNearbyCustomer: () => undefined,
      markCustomerHandled: () => undefined,
      upsertCustomer,
      refreshCustomers: async () => [],
      refreshCurrentTour,
      refreshRuntime: async () => {
        await refreshCurrentTour().catch(() => undefined);
      },
      hydrateCurrentTour: setTour,
      replaceCurrentTour: setTour,
    }),
    [currentTour, gps, refreshCurrentTour, setTour, upsertCustomer],
  );

  return (
    <DriverRuntimeContext.Provider value={value}>
      {children}
      {isTourInProgress ? <GpsSyncPill state={syncState} deviceOnline={deviceOnline} /> : null}
    </DriverRuntimeContext.Provider>
  );
}
