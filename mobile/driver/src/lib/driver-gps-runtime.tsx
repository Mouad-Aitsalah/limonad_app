import * as React from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import { dropGpsPointsForOtherTours, enqueueGpsPoint } from "@/lib/gps/gps-offline-queue";
import { configureGpsSync, flushGpsQueue } from "@/lib/gps/gps-sync";
import { deriveClientPingId, type GpsStatus } from "@/lib/gps/gps-utils";
import type { CurrentDriverTourDto } from "@/types/operations-dto";

import { apiUrl, API_BASE_URL } from "./api-base";
import { DriverGpsStatusContext } from "./driver-gps-status-context";
import { mobileFetch } from "./mobile-fetch";
import { startNativeTracking, stopNativeTracking } from "@/lib/gps/native-tracking";

const GPS_START_HOUR = 8;
const GPS_STOP_HOUR = 18;

/**
 * App-wide Android tour/GPS coordinator.
 *
 * NEW RULE (GPS/tournee/chargement independence): the native tracker is
 * driven ONLY by the 08:00-18:00 clock window and the plugin/permission
 * reality - never by a tour's status and never by whether the truck has a
 * chargement. A tour is still auto-started/resumed here (best-effort, so a
 * tourId exists to correlate GPS points against - TourLocationPing.tourId is
 * NOT NULL server-side) but its outcome no longer gates the tracker: since
 * lib/server/tours.ts#claimLoadingAndStartTour no longer requires a
 * chargement, that auto-start now succeeds for any active driver+truck, so
 * in practice the tracker and the tour move together - but a failure (e.g.
 * a transient network error) still leaves the clock in sole control of
 * start/stop, it just means no tourId is available to attach points to
 * until the next successful refresh.
 *
 * It reuses the existing tour API, native BackgroundGeolocation singleton and
 * GPS queue. The timer/appStateChange listener only wake an already-running
 * WebView to recalculate the local phone-time window; neither is the GPS
 * mechanism itself and cannot create a second watcher. Once native tracking
 * is started, the plugin keeps the foreground service alive while the
 * WebView is backgrounded.
 */
export function DriverGpsRuntime({
  token,
  online,
  children,
}: {
  token: string | null;
  online: boolean;
  children?: React.ReactNode;
}) {
  const activeTourIdRef = React.useRef<string | null>(null);
  const refreshInFlightRef = React.useRef(false);
  // Only the token/native-tracker-derived part of the status is real React
  // state (set from inside the async refresh() below, never synchronously in
  // an effect body). The "no token / offline" case is a pure derivation from
  // props, computed below instead of being pushed into this state.
  const [nativeStatus, setNativeStatus] = React.useState<GpsStatus>("INACTIVE");
  const status: GpsStatus = !token || !online ? "INACTIVE" : nativeStatus;

  React.useEffect(() => {
    configureGpsSync(
      () => activeTourIdRef.current,
      token ? { endpoint: apiUrl("/api/driver/tour/location/batch"), headers: { Authorization: `Bearer ${token}` } } : {},
    );
  }, [token]);

  React.useEffect(() => {
    if (!token || !online) {
      activeTourIdRef.current = null;
      void stopNativeTracking();
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
        const hour = new Date().getHours();
        const withinWindow = hour >= GPS_START_HOUR && hour < GPS_STOP_HOUR;

        if (!withinWindow) {
          activeTourIdRef.current = null;
          if (!disposed) setNativeStatus("INACTIVE");
          await stopNativeTracking();
          return;
        }

        if (!Capacitor.isNativePlatform()) {
          // Nothing to run natively here (web/preview) - the clock window is
          // still correct, just has no background tracker to report on.
          if (!disposed) setNativeStatus("UNAVAILABLE");
          return;
        }

        if (!disposed) setNativeStatus((previous) => (previous === "ACTIVE" ? previous : "SEARCHING"));

        // Best-effort: try to have a real tour (auto-started/resumed) to
        // attach GPS points to. Its failure never stops the tracker itself
        // below - only whether points can be correlated to a tour yet.
        let current: CurrentDriverTourDto | null = null;
        const loaded = await mobileFetch<{ currentTour?: CurrentDriverTourDto }>("/api/driver/tour", token);
        if (loaded.kind === "ok") current = loaded.data.currentTour ?? null;

        if (current?.tour?.status !== "IN_PROGRESS") {
          const started = await mobileFetch("/api/driver/tour/start", token, { method: "POST" });
          if (started.kind === "ok") {
            const refreshed = await mobileFetch<{ currentTour?: CurrentDriverTourDto }>("/api/driver/tour", token);
            if (refreshed.kind === "ok") current = refreshed.data.currentTour ?? current;
          }
        }

        if (disposed) return;
        const tourId = current?.tour?.status === "IN_PROGRESS" ? current.tour.id : null;
        activeTourIdRef.current = tourId;

        if (!tourId) {
          // Within the clock window but no tour to attach points to yet
          // (e.g. transient error above) - the tracker cannot post anywhere
          // server-side without one, so it stays paused, not "inactive": the
          // very next 60s tick retries.
          await stopNativeTracking();
          setNativeStatus("SEARCHING");
          return;
        }

        await dropGpsPointsForOtherTours(tourId);
        const started = await startNativeTracking(tourId, (position) => {
          const capturedAtMs = Date.parse(position.recordedAt);
          void enqueueGpsPoint({
            tourId,
            clientPingId: deriveClientPingId("n", capturedAtMs, position.latitude, position.longitude),
            latitude: position.latitude,
            longitude: position.longitude,
            accuracy: position.accuracy,
            speed: position.speed,
            heading: position.heading,
            capturedAt: position.recordedAt,
          }).then(() => flushGpsQueue({ force: true }));
        }, { apiBaseUrl: API_BASE_URL, bearerToken: token });
        if (!disposed) setNativeStatus(started ? "ACTIVE" : "DENIED");
        void flushGpsQueue({ force: true });
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    const schedule = () => {
      timer = setTimeout(() => {
        void refresh().finally(schedule);
      }, 60_000);
    };
    const onResume = () => void refresh();
    void refresh().finally(schedule);
    document.addEventListener("visibilitychange", onResume);
    const appStateListener = Capacitor.isNativePlatform()
      ? CapacitorApp.addListener("appStateChange", ({ isActive }) => {
          if (isActive) onResume();
        })
      : null;
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onResume);
      void appStateListener?.then((listener) => listener.remove());
    };
  }, [online, token]);

  return (
    <DriverGpsStatusContext.Provider value={status}>{children ?? null}</DriverGpsStatusContext.Provider>
  );
}
