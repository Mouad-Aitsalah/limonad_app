import {
  GPS_GOOD_ACCURACY_METERS,
  GPS_STOP_ACTIVE_GRACE_MS,
  GPS_STOP_EXIT_CONFIRMATION_POINTS,
  GPS_STOP_EXIT_RADIUS_METERS,
  GPS_STOP_MIN_DURATION_MS,
  GPS_STOP_RADIUS_METERS,
} from "@/lib/gps/gps-config";
import {
  calculateDistanceMeters,
  splitGpsRouteIntoSegments,
  type GpsPointLike,
} from "@/lib/gps/gps-utils";
import type { DriverTourStopDto } from "@/types/operations-dto";

type InternalGpsPoint<T extends GpsPointLike> = T & {
  recordedAtMs: number;
};

type StopCenter = {
  latitude: number;
  longitude: number;
};

type StopCandidate<T extends GpsPointLike> = {
  startedAt: InternalGpsPoint<T>;
  lastStationary: InternalGpsPoint<T>;
  center: StopCenter;
  centerLatitudeWeightedSum: number;
  centerLongitudeWeightedSum: number;
  centerWeightSum: number;
  stationaryPointCount: number;
  reliableStationaryPointCount: number;
  pendingExitPoint: InternalGpsPoint<T> | null;
  pendingExitCount: number;
};

type StopPointDisposition =
  | "INSIDE"
  | "UNCERTAIN"
  | "AMBIGUOUS_OUTSIDE"
  | "OUTSIDE";

export type DetectedGpsStopsSummary = {
  count: number;
  activeCount: number;
  totalDurationSeconds: number;
};

export function detectGpsStops<T extends GpsPointLike>(
  points: T[],
  options?: { now?: number },
): DriverTourStopDto[] {
  if (points.length === 0) {
    return [];
  }

  const nowMs = options?.now ?? Date.now();
  const segments = splitGpsRouteIntoSegments(points)
    .map(normalizeGpsSegment)
    .filter((segment) => segment.length > 0);

  const stops: DriverTourStopDto[] = [];

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex]!;
    const hasLaterSegment = segmentIndex < segments.length - 1;
    let candidate: StopCandidate<T> | null = null;

    for (const point of segment) {
      if (!candidate) {
        candidate = createStopCandidate(point);
        continue;
      }

      const disposition = classifyPointAgainstStop(candidate, point);

      if (disposition === "INSIDE") {
        absorbInsidePoint(candidate, point);
        continue;
      }

      if (disposition === "UNCERTAIN") {
        absorbUncertainPoint(candidate, point);
        continue;
      }

      if (disposition === "AMBIGUOUS_OUTSIDE") {
        resetExitConfirmation(candidate);
        continue;
      }

      const confirmedExitPoint = registerOutsidePoint(candidate, point);
      if (!confirmedExitPoint) {
        continue;
      }

      const detectedStop = finalizeStopCandidate(candidate, {
        segmentIndex,
        nowMs,
        confirmedExitPoint,
        forceClosed: false,
      });
      if (detectedStop) {
        stops.push(detectedStop);
      }

      candidate = createStopCandidate(point);
    }

    if (!candidate) {
      continue;
    }

    const trailingStop = finalizeStopCandidate(candidate, {
      segmentIndex,
      nowMs,
      confirmedExitPoint: null,
      forceClosed: hasLaterSegment,
    });
    if (trailingStop) {
      stops.push(trailingStop);
    }
  }

  return stops;
}

export function getGpsStopDurationSeconds(
  stop: Pick<DriverTourStopDto, "startedAt" | "endedAt" | "durationSeconds" | "isActive">,
  now = Date.now(),
) {
  if (stop.isActive && !stop.endedAt) {
    const startedAtMs = Date.parse(stop.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return stop.durationSeconds;
    }

    return Math.max(stop.durationSeconds, Math.round((now - startedAtMs) / 1000));
  }

  return stop.durationSeconds;
}

export function summarizeDetectedGpsStops(
  stops: DriverTourStopDto[],
  now = Date.now(),
): DetectedGpsStopsSummary {
  return {
    count: stops.length,
    activeCount: stops.filter((stop) => stop.isActive).length,
    totalDurationSeconds: stops.reduce(
      (sum, stop) => sum + getGpsStopDurationSeconds(stop, now),
      0,
    ),
  };
}

function normalizeGpsSegment<T extends GpsPointLike>(segment: T[]) {
  return segment.flatMap((point) => {
    const recordedAtMs = Date.parse(point.recordedAt);
    if (!Number.isFinite(recordedAtMs)) {
      return [];
    }

    return [{ ...point, recordedAtMs }];
  });
}

function createStopCandidate<T extends GpsPointLike>(point: InternalGpsPoint<T>): StopCandidate<T> {
  const isReliable = isPointReliableEnoughForStopDecision(point);
  const weight = isReliable ? resolveStopCenterWeight(point) : 0;

  return {
    startedAt: point,
    lastStationary: point,
    center: {
      latitude: point.latitude,
      longitude: point.longitude,
    },
    centerLatitudeWeightedSum: point.latitude * weight,
    centerLongitudeWeightedSum: point.longitude * weight,
    centerWeightSum: weight,
    stationaryPointCount: isReliable ? 1 : 0,
    reliableStationaryPointCount: isReliable ? 1 : 0,
    pendingExitPoint: null,
    pendingExitCount: 0,
  };
}

function absorbInsidePoint<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  point: InternalGpsPoint<T>,
) {
  resetExitConfirmation(candidate);

  if (!isPointReliableEnoughForStopDecision(point)) {
    return;
  }

  registerReliableStationaryPoint(candidate, point);
  extendStopCenter(candidate, point);
}

function absorbUncertainPoint<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  point: InternalGpsPoint<T>,
) {
  resetExitConfirmation(candidate);

  if (!isPointReliableEnoughForStopDecision(point)) {
    return;
  }

  registerReliableStationaryPoint(candidate, point);
}

function resetExitConfirmation<T extends GpsPointLike>(candidate: StopCandidate<T>) {
  candidate.pendingExitPoint = null;
  candidate.pendingExitCount = 0;
}

function extendStopCenter<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  point: InternalGpsPoint<T>,
) {
  if (candidate.centerWeightSum === 0) {
    initializeStopCenter(candidate, point);
    return;
  }

  const weight = resolveStopCenterWeight(point);

  candidate.centerLatitudeWeightedSum += point.latitude * weight;
  candidate.centerLongitudeWeightedSum += point.longitude * weight;
  candidate.centerWeightSum += weight;
  candidate.center = {
    latitude: candidate.centerLatitudeWeightedSum / candidate.centerWeightSum,
    longitude: candidate.centerLongitudeWeightedSum / candidate.centerWeightSum,
  };
}

function registerReliableStationaryPoint<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  point: InternalGpsPoint<T>,
) {
  if (candidate.reliableStationaryPointCount === 0) {
    candidate.startedAt = point;
  }

  candidate.lastStationary = point;
  candidate.stationaryPointCount += 1;
  candidate.reliableStationaryPointCount += 1;

  if (candidate.centerWeightSum === 0) {
    initializeStopCenter(candidate, point);
  }
}

function initializeStopCenter<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  point: InternalGpsPoint<T>,
) {
  const weight = resolveStopCenterWeight(point);

  candidate.center = {
    latitude: point.latitude,
    longitude: point.longitude,
  };
  candidate.centerLatitudeWeightedSum = point.latitude * weight;
  candidate.centerLongitudeWeightedSum = point.longitude * weight;
  candidate.centerWeightSum = weight;
}

function classifyPointAgainstStop<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  point: InternalGpsPoint<T>,
): StopPointDisposition {
  const distanceToCenter = calculateDistanceMeters(candidate.center, point);

  if (distanceToCenter <= GPS_STOP_RADIUS_METERS) {
    return "INSIDE";
  }

  if (distanceToCenter <= GPS_STOP_EXIT_RADIUS_METERS) {
    return "UNCERTAIN";
  }

  if (!isPointReliableEnoughForStopDecision(point)) {
    return "AMBIGUOUS_OUTSIDE";
  }

  const accuracyMeters = resolvePointAccuracyMeters(point);
  if (accuracyMeters !== null && distanceToCenter - accuracyMeters <= GPS_STOP_RADIUS_METERS) {
    return "AMBIGUOUS_OUTSIDE";
  }

  return "OUTSIDE";
}

function registerOutsidePoint<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  point: InternalGpsPoint<T>,
) {
  if (!candidate.pendingExitPoint) {
    candidate.pendingExitPoint = point;
    candidate.pendingExitCount = 1;
    return null;
  }

  candidate.pendingExitCount += 1;

  if (candidate.pendingExitCount >= GPS_STOP_EXIT_CONFIRMATION_POINTS) {
    return candidate.pendingExitPoint;
  }

  return null;
}

function finalizeStopCandidate<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  options: {
    segmentIndex: number;
    nowMs: number;
    confirmedExitPoint: InternalGpsPoint<T> | null;
    forceClosed: boolean;
  },
): DriverTourStopDto | null {
  const endedAtMs = resolveStopEndTimestamp(candidate, options);
  const durationMs = endedAtMs - candidate.startedAt.recordedAtMs;

  if (
    candidate.stationaryPointCount < 2 ||
    candidate.reliableStationaryPointCount < 2 ||
    durationMs < GPS_STOP_MIN_DURATION_MS
  ) {
    return null;
  }

  const isActive =
    !options.forceClosed &&
    !options.confirmedExitPoint &&
    options.nowMs - candidate.lastStationary.recordedAtMs <= GPS_STOP_ACTIVE_GRACE_MS;

  return {
    id: `stop-${options.segmentIndex + 1}-${candidate.startedAt.recordedAtMs}`,
    latitude: roundCoordinate(candidate.center.latitude),
    longitude: roundCoordinate(candidate.center.longitude),
    startedAt: candidate.startedAt.recordedAt,
    endedAt: isActive ? null : new Date(endedAtMs).toISOString(),
    durationSeconds: Math.max(0, Math.round(durationMs / 1000)),
    isActive,
  };
}

function resolveStopEndTimestamp<T extends GpsPointLike>(
  candidate: StopCandidate<T>,
  options: {
    nowMs: number;
    confirmedExitPoint: InternalGpsPoint<T> | null;
    forceClosed: boolean;
  },
) {
  if (options.confirmedExitPoint) {
    return options.confirmedExitPoint.recordedAtMs;
  }

  if (options.forceClosed) {
    return candidate.lastStationary.recordedAtMs;
  }

  if (options.nowMs - candidate.lastStationary.recordedAtMs <= GPS_STOP_ACTIVE_GRACE_MS) {
    return options.nowMs;
  }

  return candidate.lastStationary.recordedAtMs;
}

function isPointReliableEnoughForStopDecision(point: Pick<GpsPointLike, "accuracy">) {
  const accuracyMeters = resolvePointAccuracyMeters(point);
  return accuracyMeters === null || accuracyMeters <= GPS_STOP_EXIT_RADIUS_METERS;
}

function resolvePointAccuracyMeters(point: Pick<GpsPointLike, "accuracy">) {
  return typeof point.accuracy === "number" && Number.isFinite(point.accuracy) && point.accuracy > 0
    ? point.accuracy
    : null;
}

function resolveStopCenterWeight(point: Pick<GpsPointLike, "accuracy">) {
  const accuracyMeters = resolvePointAccuracyMeters(point) ?? GPS_STOP_RADIUS_METERS / 2;
  const boundedAccuracy = clamp(accuracyMeters, 5, GPS_GOOD_ACCURACY_METERS);
  return 1 / boundedAccuracy;
}

function roundCoordinate(value: number) {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
