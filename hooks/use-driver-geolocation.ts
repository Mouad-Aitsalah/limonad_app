"use client";

import * as React from "react";

import {
  GPS_GAP_MS,
  GPS_LOCATION_PUSH_MIN_DELAY_MS,
  GPS_LOCATION_PUSH_MIN_DISTANCE_METERS,
  GPS_MAX_TRUCK_SPEED_KMH,
  GPS_MAX_USABLE_ACCURACY_METERS,
} from "@/lib/gps/gps-config";

/** How often we quietly re-check permission / restart a possibly-stalled watch, with no user action. */
const GPS_AUTO_RECOVERY_INTERVAL_MS = 30_000;
/** If neither a position nor an error callback fires for this long while active, the watch is assumed dead and is silently restarted. */
const GPS_WATCHDOG_SILENCE_MS = 45_000;
import {
  calculateDistanceMeters,
  classifyGpsStatus,
  isGpsPointReliable,
  isGpsPointUsable,
  type GpsFailureKind,
  type GpsStatus,
} from "@/lib/gps/gps-utils";
import {
  browserGpsProvider,
  isSecureGeolocationContext,
  type GpsPermissionState,
  type GpsProviderError,
  type GpsProviderPosition,
} from "@/lib/gps/gps-provider";

export type { GpsStatus } from "@/lib/gps/gps-utils";

export type DriverGpsPosition = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  recordedAt: string;
};

const GPS_FIRST_FIX_TIMEOUT_MS = 15_000;
const GPS_WATCH_TIMEOUT_MS = 15_000;
const GPS_WATCH_MAX_AGE_MS = 10_000;
const GPS_MANUAL_CAPTURE_TIMEOUT_MS = 8_000;
/** How often we re-evaluate freshness even without a new GPS fix (so a stale position ages out on screen). */
const GPS_CLOCK_TICK_MS = 15_000;

function toDriverGpsPosition(position: GpsProviderPosition): DriverGpsPosition {
  return {
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy: position.accuracy,
    speed: position.speed,
    heading: position.heading,
    recordedAt: new Date(position.timestamp).toISOString(),
  };
}

/**
 * Central GPS layer for the driver tour. Owns permission checks, first
 * acquisition, the watchPosition lifecycle, retry, throttled push-worthiness,
 * and status classification. Consumers (map, header badge, error panel)
 * should only read the returned state — never touch navigator.geolocation
 * directly, so this stays the single place tracking behavior can change
 * (e.g. swapping BrowserGpsProvider for a future external GPS source).
 */
export function useDriverGeolocation({
  active,
  initialPosition = null,
  onReliablePosition,
}: {
  /** Gate for the whole tracking lifecycle — typically "tour is IN_PROGRESS". */
  active: boolean;
  /** Seeds the hook with a server-known last position (e.g. on first render). */
  initialPosition?: DriverGpsPosition | null;
  /** Called (throttled) whenever a fresh, accurate-enough point is worth sending to the server. */
  onReliablePosition: (position: DriverGpsPosition) => void | Promise<void>;
}) {
  const [livePosition, setLivePosition] = React.useState<DriverGpsPosition | null>(
    initialPosition,
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [failureKind, setFailureKind] = React.useState<GpsFailureKind>(null);
  const [permissionState, setPermissionState] = React.useState<GpsPermissionState | null>(
    null,
  );
  const [searching, setSearching] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [now, setNow] = React.useState(() =>
    initialPosition ? Date.parse(initialPosition.recordedAt) : Date.now(),
  );

  const suspendedRef = React.useRef(false);
  const watchHandleRef = React.useRef<{ clear: () => void } | null>(null);
  const lastPushedRef = React.useRef<{
    latitude: number;
    longitude: number;
    recordedAtMs: number;
  } | null>(null);
  const pushingRef = React.useRef(false);
  /** Baseline for the jump-distance sanity check — the last point actually accepted as the live/displayed position (not merely received). */
  const lastAcceptedRef = React.useRef<DriverGpsPosition | null>(initialPosition);
  /** Last time any watchPosition callback (success or error) fired — feeds the stalled-watch watchdog. Null until the first callback. */
  const lastCallbackAtRef = React.useRef<number | null>(null);

  const supported = React.useMemo(() => browserGpsProvider.isSupported(), []);
  const secureContext = React.useMemo(() => isSecureGeolocationContext(), []);

  const displayPosition = React.useMemo(
    () => (livePosition && isGpsPointUsable(livePosition, now) ? livePosition : null),
    [livePosition, now],
  );
  const reliablePosition = React.useMemo(
    () => (livePosition && isGpsPointReliable(livePosition, now) ? livePosition : null),
    [livePosition, now],
  );
  /**
   * Never expires and is never cleared by a poor-accuracy or implausible-jump
   * fix — this is what the map marker renders. GPS going quiet (timeout,
   * temporary loss of signal, one bad fix) must never move or hide the truck;
   * it simply keeps showing wherever it last legitimately was until a new
   * valid point arrives.
   */
  const lastKnownPosition = livePosition;

  React.useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), GPS_CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, [active]);

  React.useEffect(() => {
    if (!active) {
      watchHandleRef.current?.clear();
      watchHandleRef.current = null;
      lastPushedRef.current = null;
      pushingRef.current = false;
      return;
    }

    if (!supported || !secureContext) {
      // Device capability / secure-context are static for the component's
      // lifetime — nothing to watch or synchronize, so both are handled via
      // render-time derivation (see `resolvedFailureKind`/`resolvedErrorMessage`
      // below) instead of setState here.
      return;
    }

    suspendedRef.current = false;
    let cancelled = false;
    // Once a DENIED error is confirmed (via the Permissions API or a live
    // geolocation call), tracking stops dead: no further getCurrentPosition
    // or watchPosition calls happen until the automatic recovery watchdog
    // (below) detects the permission has since been granted and calls retry().
    let denied = false;
    let handle: { clear: () => void } | null = null;

    async function pushIfDue(position: DriverGpsPosition, nowMs: number) {
      const lastPushed = lastPushedRef.current;

      if (lastPushed) {
        const distanceMeters = calculateDistanceMeters(lastPushed, position);

        // Throttle only — plausibility was already enforced in handlePosition
        // before this point ever became the live/displayed position, so this
        // is purely "don't spam the server with near-identical points".
        if (
          nowMs - lastPushed.recordedAtMs < GPS_LOCATION_PUSH_MIN_DELAY_MS &&
          distanceMeters < GPS_LOCATION_PUSH_MIN_DISTANCE_METERS
        ) {
          return;
        }
      }

      if (pushingRef.current || suspendedRef.current) {
        return;
      }

      pushingRef.current = true;
      try {
        await onReliablePosition(position);
        lastPushedRef.current = {
          latitude: position.latitude,
          longitude: position.longitude,
          recordedAtMs: nowMs,
        };
      } finally {
        pushingRef.current = false;
      }
    }

    function handlePosition(raw: GpsProviderPosition) {
      if (suspendedRef.current) return;

      const nowMs = Date.now();
      const position = toDriverGpsPosition(raw);
      lastCallbackAtRef.current = nowMs;

      if (process.env.NODE_ENV !== "production") {
        console.log("[gps] point received", {
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          recordedAt: position.recordedAt,
        });
      }

      setSearching(false);
      setNow(nowMs);

      // A poor-accuracy or stale fix is simply ignored: the last known
      // position (already on screen) is left exactly where it was, never
      // cleared. Only the status message reflects that this particular fix
      // wasn't usable.
      if (!isGpsPointUsable(position, nowMs)) {
        setFailureKind("IMPRECISE");
        setErrorMessage(
          position.accuracy && position.accuracy > GPS_MAX_USABLE_ACCURACY_METERS
            ? `Position trop imprecise (+/-${Math.round(position.accuracy)} m).`
            : "Position GPS indisponible ou imprecise.",
        );
        return;
      }

      // Reject implausible jumps (e.g. a stray multi-km spike) relative to
      // the last accepted point BEFORE it can ever become the live/displayed
      // position - so a bad fix never moves the truck marker even briefly.
      const lastAccepted = lastAcceptedRef.current;
      if (lastAccepted) {
        const elapsedMs = Date.parse(position.recordedAt) - Date.parse(lastAccepted.recordedAt);
        if (elapsedMs > 0 && elapsedMs <= GPS_GAP_MS) {
          const distanceMeters = calculateDistanceMeters(lastAccepted, position);
          const speedKmh = (distanceMeters / (elapsedMs / 1000)) * 3.6;
          if (speedKmh > GPS_MAX_TRUCK_SPEED_KMH) {
            setErrorMessage("Point GPS ignore: deplacement impossible detecte.");
            return;
          }
        }
      }

      lastAcceptedRef.current = position;
      setLivePosition(position);

      if (!isGpsPointReliable(position, nowMs)) {
        setFailureKind(null);
        setErrorMessage(
          position.accuracy
            ? `Position approximative (+/-${Math.round(position.accuracy)} m).`
            : "Position approximative.",
        );
        return;
      }

      setFailureKind(null);
      setErrorMessage(null);
      void pushIfDue(position, nowMs);
    }

    function handleError(error: GpsProviderError) {
      lastCallbackAtRef.current = Date.now();

      // Permission denial is terminal for this attempt: getCurrentPosition and
      // watchPosition can both report it independently, so once it's recorded
      // once, later calls are dropped instead of re-logging/re-rendering it.
      if (suspendedRef.current || denied) return;

      // Expected GPS failures (denied/timeout/unavailable) are functional
      // states, not application errors — they're always surfaced in the UI
      // via errorMessage/status, so no console.error (which the Next.js dev
      // overlay treats as a fatal error). A quiet console.warn is enough to
      // keep them traceable in devtools without popping the red overlay.
      if (process.env.NODE_ENV !== "production") {
        console.warn("[gps]", error.kind, error.message);
      }

      if (error.kind === "DENIED") {
        denied = true;
        handle?.clear();
        if (watchHandleRef.current === handle) {
          watchHandleRef.current = null;
        }
        handle = null;
      }

      setSearching(false);
      setFailureKind(error.kind);
      setErrorMessage(error.message);
    }

    function requestFreshFix() {
      setSearching(true);
      setErrorMessage(null);
      setFailureKind(null);

      browserGpsProvider
        .getCurrentPosition({ timeoutMs: GPS_FIRST_FIX_TIMEOUT_MS })
        .then((position) => {
          if (!cancelled) handlePosition(position);
        })
        .catch((error: GpsProviderError) => {
          if (!cancelled) handleError(error);
        });
    }

    function beginTracking() {
      requestFreshFix();

      handle = browserGpsProvider.watchPosition(handlePosition, handleError, {
        maximumAgeMs: GPS_WATCH_MAX_AGE_MS,
        timeoutMs: GPS_WATCH_TIMEOUT_MS,
      });
      watchHandleRef.current = handle;
    }

    // Check permission state before touching any geolocation API: if it's
    // already known to be denied, never call getCurrentPosition/watchPosition
    // at all (no point asking twice) — just surface the denial; the watchdog
    // effect below will call retry() automatically once it detects the
    // permission has been granted.
    void browserGpsProvider.queryPermissionState().then((state) => {
      if (cancelled) return;
      setPermissionState(state);

      if (state === "denied") {
        denied = true;
        setSearching(false);
        setFailureKind("DENIED");
        setErrorMessage(
          "Localisation bloquee dans le navigateur. Cliquez sur l'icone a gauche de l'adresse du site et autorisez la localisation.",
        );
        return;
      }

      beginTracking();
    });

    return () => {
      cancelled = true;
      handle?.clear();
      if (watchHandleRef.current === handle) {
        watchHandleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onReliablePosition is expected to be stable per tour; re-running on every render identity change would restart the GPS watcher unnecessarily.
  }, [active, attempt, supported, secureContext]);

  // Device support and secure-context are static for the component's
  // lifetime, so these cases are derived here at render time rather than via
  // setState in the effect.
  const resolvedFailureKind: GpsFailureKind = !supported
    ? "UNAVAILABLE"
    : !secureContext
      ? "INSECURE_CONTEXT"
      : failureKind;
  const resolvedErrorMessage = !supported
    ? "La geolocalisation n'est pas disponible sur cet appareil."
    : !secureContext
      ? "Le GPS necessite une connexion HTTPS sur mobile ou via une adresse reseau."
      : errorMessage;

  const status: GpsStatus = React.useMemo(
    () =>
      classifyGpsStatus({
        active,
        searching,
        failureKind: resolvedFailureKind,
        displayPosition,
        reliablePosition,
        latestPositionAt: livePosition?.recordedAt ?? null,
        now,
      }),
    [active, searching, resolvedFailureKind, displayPosition, reliablePosition, livePosition, now],
  );

  /** Forces a brand-new getCurrentPosition/watchPosition cycle — never trusts the browser cache. */
  const retry = React.useCallback(() => {
    suspendedRef.current = false;
    setSearching(true);
    setErrorMessage(null);
    setFailureKind(null);
    setAttempt((value) => value + 1);
  }, []);

  const captureFreshPosition = React.useCallback(
    async (options?: { timeoutMs?: number }) => {
      if (!active || !supported || !secureContext || suspendedRef.current) {
        return null;
      }

      setSearching(true);
      setErrorMessage(null);
      setFailureKind(null);

      try {
        const raw = await browserGpsProvider.getCurrentPosition({
          timeoutMs: options?.timeoutMs ?? GPS_MANUAL_CAPTURE_TIMEOUT_MS,
        });
        const nowMs = Date.now();
        const position = toDriverGpsPosition(raw);

        setSearching(false);
        setNow(nowMs);

        if (!isGpsPointUsable(position, nowMs)) {
          setFailureKind("IMPRECISE");
          setErrorMessage(
            position.accuracy && position.accuracy > GPS_MAX_USABLE_ACCURACY_METERS
              ? `Position trop imprecise (+/-${Math.round(position.accuracy)} m).`
              : "Position GPS indisponible ou imprecise.",
          );
          return null;
        }

        const lastAccepted = lastAcceptedRef.current;
        if (lastAccepted) {
          const elapsedMs =
            Date.parse(position.recordedAt) - Date.parse(lastAccepted.recordedAt);
          if (elapsedMs > 0 && elapsedMs <= GPS_GAP_MS) {
            const distanceMeters = calculateDistanceMeters(lastAccepted, position);
            const speedKmh = (distanceMeters / (elapsedMs / 1000)) * 3.6;
            if (speedKmh > GPS_MAX_TRUCK_SPEED_KMH) {
              setErrorMessage("Point GPS ignore: deplacement impossible detecte.");
              return null;
            }
          }
        }

        lastAcceptedRef.current = position;
        setLivePosition(position);

        if (!isGpsPointReliable(position, nowMs)) {
          setFailureKind(null);
          setErrorMessage(
            position.accuracy
              ? `Position approximative (+/-${Math.round(position.accuracy)} m).`
              : "Position approximative.",
          );
          return null;
        }

        setFailureKind(null);
        setErrorMessage(null);
        return position;
      } catch (error) {
        const gpsError = error as GpsProviderError;
        setSearching(false);
        setFailureKind(gpsError.kind);
        setErrorMessage(gpsError.message);
        return null;
      }
    },
    [active, secureContext, supported],
  );

  /** Reseeds the hook when a tour boundary changes what "current position" means (start/return). */
  const reset = React.useCallback((position: DriverGpsPosition | null = null) => {
    setLivePosition(position);
    setNow(Date.now());
    setErrorMessage(null);
    setFailureKind(null);
    lastPushedRef.current = null;
    lastAcceptedRef.current = position;
    pushingRef.current = false;
  }, []);

  // Fully automatic recovery, with no "Reessayer" button: if permission was
  // denied, quietly re-check whether it has since been granted (e.g. the
  // driver changed it in browser settings); if the watch has gone silent for
  // too long (no success AND no error callback at all — a real dead watch on
  // some mobile browsers), restart it once. Both paths funnel through the
  // same `retry()` used to re-run the single tracking effect above, so there
  // is never more than one watchPosition alive at a time.
  React.useEffect(() => {
    if (!active) return;

    const id = window.setInterval(() => {
      if (failureKind === "DENIED") {
        void browserGpsProvider.queryPermissionState().then((state) => {
          if (state !== "denied") retry();
        });
        return;
      }

      if (
        lastCallbackAtRef.current !== null &&
        Date.now() - lastCallbackAtRef.current > GPS_WATCHDOG_SILENCE_MS
      ) {
        retry();
      }
    }, GPS_AUTO_RECOVERY_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [active, failureKind, retry]);

  /** Immediately halts tracking without waiting for `active` to flip on next render. */
  const stop = React.useCallback(() => {
    suspendedRef.current = true;
    watchHandleRef.current?.clear();
    watchHandleRef.current = null;
  }, []);

  return {
    status,
    displayPosition,
    reliablePosition,
    lastKnownPosition,
    errorMessage: resolvedErrorMessage,
    failureKind: resolvedFailureKind,
    permissionState,
    searching,
    supported,
    /** Exposed for completeness (e.g. a future debug affordance) — recovery is now fully automatic, see the watchdog effect above. */
    retry,
    captureFreshPosition,
    reset,
    stop,
  };
}
