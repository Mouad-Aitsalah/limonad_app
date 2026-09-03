"use client";

import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";

/**
 * Native (Capacitor) background GPS tracking for the driver tour.
 *
 * The web app keeps using hooks/use-driver-geolocation.ts (navigator.geolocation)
 * completely unchanged - every function here is a no-op unless
 * Capacitor.isNativePlatform() is true, so importing this module has zero
 * effect on the browser experience.
 *
 * On native, tracking is configured with `url`/`headers` (see
 * StartOptions in @capgo/background-geolocation) so Android/iOS POST every
 * point straight to /api/driver/tour/location/native from native code -
 * never a fetch() from this module or from the JS callback below. That
 * native POST is what survives the WebView being suspended (backgrounded,
 * screen locked, another app opened); a JS-side fetch() would not; Android
 * additionally throttles WebView-initiated HTTP requests after ~5 minutes
 * in the background regardless, which useLegacyBridge does not lift for
 * plain fetch() - only for the plugin's own native delivery.
 *
 * The JS callback passed to start() is UI-only (see DriverRuntimeProvider,
 * which feeds it into the same live-position state the map marker reads)
 * - it must never also fetch(), or every point would be written twice.
 *
 * --- iOS (not yet added to this project) ---
 * When ios/ is added, Info.plist will need:
 *   NSLocationWhenInUseUsageDescription
 *   NSLocationAlwaysAndWhenInUseUsageDescription
 *   UIBackgroundModes = ["location"]
 * (exact copy in node_modules/@capgo/background-geolocation/README.md).
 * Everything in this module already works unchanged once that's done -
 * Capacitor.isNativePlatform() is true on iOS the same as on Android. Apple
 * can still stop tracking if the user force-quits the app; that is an OS
 * restriction this plugin (or any plugin) cannot override, unlike Android's
 * restartable foreground service.
 */

export type NativeGpsPosition = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
};

const BACKGROUND_TITLE = "COMDIS Driver";
const BACKGROUND_MESSAGE = "Suivi GPS de votre tournee en cours";
const DISTANCE_FILTER_METERS = 20;
const MIN_INTERVAL_MS = 30_000;

// Phase 5C - the native tracking token (lib/server/tracking-token.ts, 16 h
// TTL) must never lapse mid-tour. We rotate it into the plugin's headers
// (BackgroundGeolocation.updateHeaders) this long before it would expire.
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000;
// When a refresh fetch fails (no network), try again this soon rather than
// waiting for the next scheduled point.
const TOKEN_REFRESH_RETRY_MS = 5 * 60 * 1000;

// Module-level (not component-level) on purpose: this is the single source
// of truth for "is a native watcher currently running, and for which tour",
// across the whole app - it must survive whichever component/effect last
// called start()/stop(), so two watchers are never started concurrently.
let activeTourId: string | null = null;
let starting = false;
let tokenExpiresAtMs: number | null = null;
let tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export function isNativeGpsPlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Starts native background tracking for the given tour, fetching a fresh
 * tracking token first. Idempotent: calling it again for the tour already
 * being tracked, or while a start is in flight, is a no-op.
 */
export async function startNativeTracking(
  tourId: string,
  onPosition?: (position: NativeGpsPosition) => void,
): Promise<boolean> {
  if (!isNativeGpsPlatform()) return false;
  if (activeTourId === tourId || starting) return true;

  starting = true;
  try {
    const issued = await fetchTrackingToken();
    if (!issued) return false;

    await BackgroundGeolocation.start(
      {
        backgroundTitle: BACKGROUND_TITLE,
        backgroundMessage: BACKGROUND_MESSAGE,
        requestPermissions: true,
        stale: false,
        distanceFilter: DISTANCE_FILTER_METERS,
        minIntervalMs: MIN_INTERVAL_MS,
        url: `${window.location.origin}/api/driver/tour/location/native`,
        headers: { Authorization: `Bearer ${issued.token}` },
      },
      (location, error) => {
        if (error) {
          console.warn("[gps-native]", error.code, error.message);
          return;
        }
        if (location && onPosition) {
          onPosition({
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: Number.isFinite(location.accuracy) ? location.accuracy : null,
            speed: location.speed ?? null,
            heading: location.bearing ?? null,
            recordedAt: location.time
              ? new Date(location.time).toISOString()
              : new Date().toISOString(),
          });
        }
      },
    );

    activeTourId = tourId;
    tokenExpiresAtMs = issued.expiresAtMs;
    scheduleTokenRefresh();
    return true;
  } catch (error) {
    console.warn("[gps-native] start failed", error);
    return false;
  } finally {
    starting = false;
  }
}

/** Stops native tracking. Safe to call even when nothing is running. */
export async function stopNativeTracking(): Promise<void> {
  clearTokenRefresh();
  if (!isNativeGpsPlatform() || activeTourId === null) return;

  activeTourId = null;
  try {
    await BackgroundGeolocation.stop();
  } catch (error) {
    console.warn("[gps-native] stop failed", error);
  }
}

/**
 * Phase 5C - called on app resume: if native tracking is running and its
 * token is inside the refresh margin, rotate it now rather than waiting for
 * the background timer (which may not have fired while the app was suspended).
 */
export async function refreshNativeTrackingTokenIfNeeded(): Promise<void> {
  if (!isNativeGpsPlatform() || activeTourId === null) return;
  if (tokenExpiresAtMs !== null && tokenExpiresAtMs - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
    scheduleTokenRefresh();
    return;
  }
  await rotateTrackingToken();
}

/** Opens the device's location settings - used when permission was refused. */
export async function openNativeLocationSettings(): Promise<void> {
  if (!isNativeGpsPlatform()) return;
  try {
    await BackgroundGeolocation.openSettings();
  } catch (error) {
    console.warn("[gps-native] openSettings failed", error);
  }
}

/**
 * Phase 5C - opens this app's system settings screen (permissions + battery
 * optimisation). `openSettings()` on Android lands on the app info page;
 * kept as a separate name from the location-permission use so call sites
 * read clearly. Same underlying call.
 */
export const openNativeAppSettings = openNativeLocationSettings;

function clearTokenRefresh() {
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
  tokenExpiresAtMs = null;
}

function scheduleTokenRefresh() {
  if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
  const delay =
    tokenExpiresAtMs !== null
      ? Math.max(60_000, tokenExpiresAtMs - Date.now() - TOKEN_REFRESH_MARGIN_MS)
      : TOKEN_REFRESH_RETRY_MS;
  tokenRefreshTimer = setTimeout(() => {
    tokenRefreshTimer = null;
    void rotateTrackingToken();
  }, delay);
}

async function rotateTrackingToken(): Promise<void> {
  if (activeTourId === null) return;
  const issued = await fetchTrackingToken();
  if (!issued) {
    // Keep the existing (still valid for a bit) token, retry sooner.
    tokenRefreshTimer = setTimeout(() => {
      tokenRefreshTimer = null;
      void rotateTrackingToken();
    }, TOKEN_REFRESH_RETRY_MS);
    return;
  }
  try {
    await BackgroundGeolocation.updateHeaders({
      headers: { Authorization: `Bearer ${issued.token}` },
    });
    tokenExpiresAtMs = issued.expiresAtMs;
  } catch (error) {
    console.warn("[gps-native] updateHeaders failed", error);
  }
  scheduleTokenRefresh();
}

async function fetchTrackingToken(): Promise<{ token: string; expiresAtMs: number } | null> {
  try {
    const response = await fetch("/api/driver/tour/location-token", { method: "POST" });
    const payload = (await response.json()) as {
      token?: string;
      expiresAt?: string;
      message?: string;
    };
    if (!response.ok || !payload.token) {
      console.warn("[gps-native] token fetch failed", payload.message);
      return null;
    }
    const parsed = payload.expiresAt ? Date.parse(payload.expiresAt) : Number.NaN;
    return {
      token: payload.token,
      // Fall back to "now + 16 h" if the server ever omits expiresAt, so the
      // refresh scheduler still has something sane to work with.
      expiresAtMs: Number.isFinite(parsed) ? parsed : Date.now() + 16 * 60 * 60 * 1000,
    };
  } catch (error) {
    console.warn("[gps-native] token fetch error", error);
    return null;
  }
}
