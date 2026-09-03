import {
  GPS_ACTIVE_MAX_AGE_MS,
  GPS_DISPLAY_ACCURACY_DISTANCE_FACTOR,
  GPS_DISPLAY_MAX_MOVEMENT_METERS,
  GPS_DISPLAY_MIN_MOVEMENT_METERS,
  GPS_DISPLAY_SIMPLIFICATION_TOLERANCE_METERS,
  GPS_DISPLAY_STATIONARY_ACCURACY_FACTOR,
  GPS_DISPLAY_STATIONARY_SPEED_KMH,
  GPS_DISPLAY_TURN_ANGLE_DEGREES,
  GPS_GAP_MS,
  GPS_GOOD_ACCURACY_METERS,
  GPS_INACTIVE_AFTER_MS,
  GPS_MAX_FUTURE_DRIFT_MS,
  GPS_MAX_TRUCK_SPEED_KMH,
  GPS_MAX_USABLE_ACCURACY_METERS,
} from "@/lib/gps/gps-config";

export type GpsPointLike = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  recordedAt: string;
};

export type DisplayGpsRouteOptions = {
  minMovementMeters: number;
  maxMovementMeters: number;
  accuracyDistanceFactor: number;
  stationaryAccuracyFactor: number;
  stationarySpeedKmh: number;
  simplificationToleranceMeters: number;
  turnAngleDegrees: number;
};

export type DisplayGpsRouteResult<T extends GpsPointLike> = {
  segments: T[][];
  pointCountBefore: number;
  pointCountAfterNoiseFilter: number;
  pointCountAfterSimplification: number;
  segmentCount: number;
};

const defaultDisplayGpsRouteOptions: DisplayGpsRouteOptions = {
  minMovementMeters: GPS_DISPLAY_MIN_MOVEMENT_METERS,
  maxMovementMeters: GPS_DISPLAY_MAX_MOVEMENT_METERS,
  accuracyDistanceFactor: GPS_DISPLAY_ACCURACY_DISTANCE_FACTOR,
  stationaryAccuracyFactor: GPS_DISPLAY_STATIONARY_ACCURACY_FACTOR,
  stationarySpeedKmh: GPS_DISPLAY_STATIONARY_SPEED_KMH,
  simplificationToleranceMeters: GPS_DISPLAY_SIMPLIFICATION_TOLERANCE_METERS,
  turnAngleDegrees: GPS_DISPLAY_TURN_ANGLE_DEGREES,
};

export function hasValidCoordinates(point: Pick<GpsPointLike, "latitude" | "longitude">) {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

/** Charset/length gate for a clientPingId, shared by client and server. */
export const CLIENT_PING_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Phase 5B - a deterministic id for one physical GPS fix, stable across every
 * (re)send. Derived purely from the fix itself (capture instant + coordinates
 * at 1e-6 deg ~= 0.1 m), so the two delivery paths for the same native point -
 * the plugin's own native POST to /api/driver/tour/location/native and the JS
 * offline-queue batch - land on the SAME (tourId, clientPingId) and are
 * deduplicated to a single row. `source` keeps web ("w") and native ("n")
 * points from ever colliding.
 */
export function deriveClientPingId(
  source: "w" | "n",
  capturedAtMs: number,
  latitude: number,
  longitude: number,
): string {
  const t = Number.isFinite(capturedAtMs) ? Math.round(capturedAtMs) : 0;
  const lat = Math.round(latitude * 1_000_000);
  const lng = Math.round(longitude * 1_000_000);
  return `${source}_${t}_${lat}_${lng}`;
}

export function hasAcceptableAccuracy(point: Pick<GpsPointLike, "accuracy">) {
  return (
    point.accuracy === null ||
    point.accuracy === undefined ||
    (Number.isFinite(point.accuracy) && point.accuracy <= GPS_GOOD_ACCURACY_METERS)
  );
}

export function hasUsableAccuracy(point: Pick<GpsPointLike, "accuracy">) {
  return (
    point.accuracy === null ||
    point.accuracy === undefined ||
    (Number.isFinite(point.accuracy) && point.accuracy <= GPS_MAX_USABLE_ACCURACY_METERS)
  );
}

/**
 * Buckets raw accuracy into the three tiers used across the app.
 * "unknown" means the device didn't report an accuracy at all.
 */
export function classifyAccuracy(
  accuracy: number | null | undefined,
): "reliable" | "approximate" | "unusable" | "unknown" {
  if (accuracy === null || accuracy === undefined || !Number.isFinite(accuracy)) {
    return "unknown";
  }
  if (accuracy <= GPS_GOOD_ACCURACY_METERS) return "reliable";
  if (accuracy <= GPS_MAX_USABLE_ACCURACY_METERS) return "approximate";
  return "unusable";
}

export function getGpsPointAgeMs(point: Pick<GpsPointLike, "recordedAt">, now = Date.now()) {
  const recordedAt = new Date(point.recordedAt).getTime();
  if (!Number.isFinite(recordedAt)) {
    return Number.POSITIVE_INFINITY;
  }

  return now - recordedAt;
}

/** "Fresh" = usable as a live/current position (tightest window). */
export function isGpsPointFresh(point: GpsPointLike, now = Date.now()) {
  const ageMs = getGpsPointAgeMs(point, now);
  return ageMs >= -GPS_MAX_FUTURE_DRIFT_MS && ageMs <= GPS_ACTIVE_MAX_AGE_MS;
}

/** "Reliable" = fresh + accurate enough for proximity/distance/route logic. */
export function isGpsPointReliable(point: GpsPointLike, now = Date.now()) {
  return (
    hasValidCoordinates(point) &&
    hasAcceptableAccuracy(point) &&
    isGpsPointFresh(point, now)
  );
}

/** "Usable" = fresh + accurate enough to merely be displayed on the map. */
export function isGpsPointUsable(point: GpsPointLike, now = Date.now()) {
  return (
    hasValidCoordinates(point) &&
    hasUsableAccuracy(point) &&
    isGpsPointFresh(point, now)
  );
}

/** Describes why a point is or isn't fit for a given purpose. */
export function validateGpsPoint(point: GpsPointLike, now = Date.now()) {
  const validCoordinates = hasValidCoordinates(point);
  const fresh = validCoordinates && isGpsPointFresh(point, now);
  const usableForCurrentPosition = validCoordinates && fresh && hasUsableAccuracy(point);
  const usableForRoute = validCoordinates && hasAcceptableAccuracy(point);
  const reliable = validCoordinates && fresh && hasAcceptableAccuracy(point);

  let reason: string | undefined;
  if (!validCoordinates) reason = "invalid_coordinates";
  else if (!fresh) reason = "stale";
  else if (!usableForCurrentPosition) reason = "inaccurate";

  return {
    valid: validCoordinates,
    usableForCurrentPosition,
    usableForRoute,
    reliable,
    reason,
  };
}

export function shouldBreakGpsSegment(previous: GpsPointLike, current: GpsPointLike) {
  const previousAt = new Date(previous.recordedAt).getTime();
  const currentAt = new Date(current.recordedAt).getTime();
  const elapsedMs = currentAt - previousAt;

  if (!Number.isFinite(previousAt) || !Number.isFinite(currentAt) || elapsedMs <= 0) {
    return true;
  }

  if (elapsedMs > GPS_GAP_MS) {
    return true;
  }

  const distanceMeters = calculateDistanceMeters(previous, current);
  const speedKmh = (distanceMeters / (elapsedMs / 1000)) * 3.6;

  return speedKmh > GPS_MAX_TRUCK_SPEED_KMH;
}

/** Alias kept for readability at call sites that reason about segments explicitly. */
export const shouldStartNewSegment = shouldBreakGpsSegment;

export function splitGpsRouteIntoSegments<T extends GpsPointLike>(points: T[]) {
  const segments: T[][] = [];

  for (const point of points) {
    if (!hasValidCoordinates(point) || !hasAcceptableAccuracy(point)) {
      continue;
    }

    const currentSegment = segments[segments.length - 1] ?? null;
    const previousPoint = currentSegment?.[currentSegment.length - 1] ?? null;

    if (!currentSegment || !previousPoint || shouldBreakGpsSegment(previousPoint, point)) {
      segments.push([point]);
      continue;
    }

    currentSegment.push(point);
  }

  return segments;
}

/** Alias kept for readability at call sites that build segments explicitly. */
export const buildGpsSegments = splitGpsRouteIntoSegments;

/**
 * Builds a map-friendly route from raw GPS history without mutating the source
 * points. The raw TourLocationPing history stays intact; only the rendered path
 * is cleaned for micro-drift and lightly simplified for readability.
 */
export function buildDisplayGpsRoute<T extends GpsPointLike>(
  points: T[],
  options?: Partial<DisplayGpsRouteOptions>,
): DisplayGpsRouteResult<T> {
  const resolvedOptions = resolveDisplayGpsRouteOptions(options);
  const sourceSegments = splitGpsRouteIntoSegments(points);
  const cleanedSegments = sourceSegments
    .map((segment) => filterGpsSegmentForDisplay(segment, resolvedOptions))
    .filter((segment) => segment.length > 0);
  const simplifiedSegments = cleanedSegments
    .map((segment) => simplifyGpsSegmentForDisplay(segment, resolvedOptions))
    .filter((segment) => segment.length > 0);

  return {
    segments: simplifiedSegments,
    pointCountBefore: sourceSegments.reduce((sum, segment) => sum + segment.length, 0),
    pointCountAfterNoiseFilter: cleanedSegments.reduce((sum, segment) => sum + segment.length, 0),
    pointCountAfterSimplification: simplifiedSegments.reduce(
      (sum, segment) => sum + segment.length,
      0,
    ),
    segmentCount: simplifiedSegments.length,
  };
}

export function buildDisplayGpsRouteSegments<T extends GpsPointLike>(
  points: T[],
  options?: Partial<DisplayGpsRouteOptions>,
) {
  return buildDisplayGpsRoute(points, options).segments;
}

export function calculateSegmentedGpsDistanceMeters(points: GpsPointLike[]) {
  return splitGpsRouteIntoSegments(points).reduce((sum, segment) => {
    return (
      sum +
      segment.reduce((segmentSum, point, index) => {
        if (index === 0) {
          return segmentSum;
        }

        return segmentSum + calculateDistanceMeters(segment[index - 1], point);
      }, 0)
    );
  }, 0);
}

export function calculateDistanceMeters(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
) {
  const earthRadius = 6371000;
  const latDelta = degreesToRadians(end.latitude - start.latitude);
  const lngDelta = degreesToRadians(end.longitude - start.longitude);
  const fromLat = degreesToRadians(start.latitude);
  const toLat = degreesToRadians(end.latitude);

  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

/** Alias matching the common name for this formula. */
export const haversineDistance = calculateDistanceMeters;

/** Meters per degree of latitude (WGS84 average) - used only to size a
 * bounding box, never for real distance math (calculateDistanceMeters above
 * stays the single source of truth for that). */
const METERS_PER_DEGREE_LATITUDE = 111_320;

/**
 * A degree box (±marginMeters in each direction) around (latitude, longitude).
 * A square of half-width R fully contains a circle of radius R, so filtering
 * DB candidates to this box before computing the real distance can never
 * exclude a point that is genuinely within marginMeters - it only skips
 * points that are provably too far to matter, exactly like a `take` cap
 * skips rows that are provably not needed. No index required: it's a plain
 * range filter, meant to bound an otherwise-unbounded proximity scan (see
 * lib/server/driver-tour.ts's upsertNearbyVisit and
 * lib/server/driver-customers.ts's getDriverProximityCustomers).
 */
export function boundingBoxAround(latitude: number, longitude: number, marginMeters: number) {
  const latDelta = marginMeters / METERS_PER_DEGREE_LATITUDE;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  // Near the poles cos(lat) -> 0, which would blow up the longitude delta -
  // never actually reached by real delivery routes, but clamped defensively.
  const lngDelta = marginMeters / (METERS_PER_DEGREE_LATITUDE * Math.max(Math.abs(cosLat), 0.01));
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLng: longitude - lngDelta,
    maxLng: longitude + lngDelta,
  };
}

export function calculateSpeedKmh(
  previous: GpsPointLike,
  current: GpsPointLike,
): number | null {
  const previousAt = new Date(previous.recordedAt).getTime();
  const currentAt = new Date(current.recordedAt).getTime();
  const elapsedMs = currentAt - previousAt;

  if (!Number.isFinite(previousAt) || !Number.isFinite(currentAt) || elapsedMs <= 0) {
    return null;
  }

  const distanceMeters = calculateDistanceMeters(previous, current);
  return (distanceMeters / (elapsedMs / 1000)) * 3.6;
}

export type GpsFreshness = "fresh" | "slow" | "inactive";

/** Coarse freshness bucket, independent of accuracy — used for status badges. */
export function getGpsFreshness(
  point: Pick<GpsPointLike, "recordedAt"> | null,
  now = Date.now(),
): GpsFreshness {
  if (!point) {
    return "inactive";
  }

  const ageMs = getGpsPointAgeMs(point, now);
  if (ageMs <= GPS_ACTIVE_MAX_AGE_MS) return "fresh";
  if (ageMs <= GPS_INACTIVE_AFTER_MS) return "slow";
  return "inactive";
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function resolveDisplayGpsRouteOptions(
  options?: Partial<DisplayGpsRouteOptions>,
): DisplayGpsRouteOptions {
  return {
    ...defaultDisplayGpsRouteOptions,
    ...options,
  };
}

function filterGpsSegmentForDisplay<T extends GpsPointLike>(
  segment: T[],
  options: DisplayGpsRouteOptions,
) {
  if (segment.length <= 1) {
    return [...segment];
  }

  const displayed: T[] = [segment[0]];

  for (let index = 1; index < segment.length; index += 1) {
    const current = segment[index];
    const lastDisplayed = displayed[displayed.length - 1];
    if (!lastDisplayed) {
      displayed.push(current);
      continue;
    }

    const distanceMeters = calculateDistanceMeters(lastDisplayed, current);
    const thresholdMeters = resolveDisplayMovementThreshold(lastDisplayed, current, options);
    const isLastPoint = index === segment.length - 1;

    if (distanceMeters >= thresholdMeters) {
      displayed.push(current);
      continue;
    }

    if (isLastPoint) {
      const previousDisplayed = displayed[displayed.length - 2] ?? null;
      const keepsRealTurn =
        previousDisplayed !== null &&
        calculateTurnAngleDegrees(previousDisplayed, lastDisplayed, current) >=
          options.turnAngleDegrees;

      if (keepsRealTurn && distanceMeters >= options.minMovementMeters * 0.5) {
        displayed.push(current);
      }
    }
  }

  return displayed;
}

function resolveDisplayMovementThreshold(
  previous: GpsPointLike,
  current: GpsPointLike,
  options: DisplayGpsRouteOptions,
) {
  const accuracyMeters = resolveConservativeAccuracyMeters(previous, current);
  const speedKmh = resolveDisplaySpeedKmh(previous, current);
  const lowSpeedOrUnknown = speedKmh === null || speedKmh <= options.stationarySpeedKmh;

  let thresholdMeters = options.minMovementMeters;

  if (accuracyMeters !== null) {
    thresholdMeters = Math.max(
      thresholdMeters,
      accuracyMeters * options.accuracyDistanceFactor,
    );

    if (lowSpeedOrUnknown) {
      thresholdMeters = Math.max(
        thresholdMeters,
        accuracyMeters * options.stationaryAccuracyFactor,
      );
    }
  }

  return clamp(
    thresholdMeters,
    options.minMovementMeters,
    options.maxMovementMeters,
  );
}

function resolveConservativeAccuracyMeters(
  previous: Pick<GpsPointLike, "accuracy">,
  current: Pick<GpsPointLike, "accuracy">,
) {
  const accuracies = [previous.accuracy, current.accuracy].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0,
  );

  if (accuracies.length === 0) {
    return null;
  }

  return Math.max(...accuracies);
}

function resolveDisplaySpeedKmh(previous: GpsPointLike, current: GpsPointLike) {
  if (
    typeof current.speed === "number" &&
    Number.isFinite(current.speed) &&
    current.speed >= 0
  ) {
    return current.speed * 3.6;
  }

  if (
    typeof previous.speed === "number" &&
    Number.isFinite(previous.speed) &&
    previous.speed >= 0
  ) {
    return previous.speed * 3.6;
  }

  return calculateSpeedKmh(previous, current);
}

function simplifyGpsSegmentForDisplay<T extends GpsPointLike>(
  segment: T[],
  options: DisplayGpsRouteOptions,
) {
  if (segment.length <= 2) {
    return [...segment];
  }

  const keep = new Array(segment.length).fill(false);
  keep[0] = true;
  keep[segment.length - 1] = true;

  for (let index = 1; index < segment.length - 1; index += 1) {
    const angleDegrees = calculateTurnAngleDegrees(
      segment[index - 1],
      segment[index],
      segment[index + 1],
    );

    if (angleDegrees >= options.turnAngleDegrees) {
      keep[index] = true;
    }
  }

  const stack: Array<[number, number]> = [[0, segment.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) {
      continue;
    }

    const [startIndex, endIndex] = range;
    if (endIndex - startIndex <= 1) {
      continue;
    }

    let farthestIndex = -1;
    let farthestDistanceMeters = 0;

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      if (keep[index]) {
        farthestIndex = index;
        farthestDistanceMeters = options.simplificationToleranceMeters + 1;
        break;
      }

      const perpendicularDistanceMeters = calculatePerpendicularDistanceMeters(
        segment[index],
        segment[startIndex],
        segment[endIndex],
      );

      if (perpendicularDistanceMeters > farthestDistanceMeters) {
        farthestDistanceMeters = perpendicularDistanceMeters;
        farthestIndex = index;
      }
    }

    if (
      farthestIndex > startIndex &&
      farthestIndex < endIndex &&
      farthestDistanceMeters > options.simplificationToleranceMeters
    ) {
      keep[farthestIndex] = true;
      stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  return segment.filter((_, index) => keep[index]);
}

function calculatePerpendicularDistanceMeters(
  point: Pick<GpsPointLike, "latitude" | "longitude">,
  start: Pick<GpsPointLike, "latitude" | "longitude">,
  end: Pick<GpsPointLike, "latitude" | "longitude">,
) {
  const originLatitude = start.latitude;
  const originLongitude = start.longitude;
  const pointXY = projectPointToMeters(point, originLatitude, originLongitude);
  const startXY = projectPointToMeters(start, originLatitude, originLongitude);
  const endXY = projectPointToMeters(end, originLatitude, originLongitude);

  const deltaX = endXY.x - startXY.x;
  const deltaY = endXY.y - startXY.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return Math.hypot(pointXY.x - startXY.x, pointXY.y - startXY.y);
  }

  const projectionRatio = clamp(
    ((pointXY.x - startXY.x) * deltaX + (pointXY.y - startXY.y) * deltaY) /
      lengthSquared,
    0,
    1,
  );
  const projectedX = startXY.x + projectionRatio * deltaX;
  const projectedY = startXY.y + projectionRatio * deltaY;

  return Math.hypot(pointXY.x - projectedX, pointXY.y - projectedY);
}

function projectPointToMeters(
  point: Pick<GpsPointLike, "latitude" | "longitude">,
  originLatitude: number,
  originLongitude: number,
) {
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude =
    111_320 * Math.cos(degreesToRadians((point.latitude + originLatitude) / 2));

  return {
    x: (point.longitude - originLongitude) * metersPerDegreeLongitude,
    y: (point.latitude - originLatitude) * metersPerDegreeLatitude,
  };
}

function calculateTurnAngleDegrees(
  previous: Pick<GpsPointLike, "latitude" | "longitude">,
  current: Pick<GpsPointLike, "latitude" | "longitude">,
  next: Pick<GpsPointLike, "latitude" | "longitude">,
) {
  const firstLeg = projectPointToMeters(previous, current.latitude, current.longitude);
  const secondLeg = projectPointToMeters(next, current.latitude, current.longitude);
  const vectorA = { x: firstLeg.x, y: firstLeg.y };
  const vectorB = { x: secondLeg.x, y: secondLeg.y };
  const magnitudeA = Math.hypot(vectorA.x, vectorA.y);
  const magnitudeB = Math.hypot(vectorB.x, vectorB.y);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  const cosine =
    (vectorA.x * vectorB.x + vectorA.y * vectorB.y) / (magnitudeA * magnitudeB);
  const normalizedCosine = clamp(cosine, -1, 1);
  const angleRadians = Math.acos(normalizedCosine);

  return Math.abs(180 - radiansToDegrees(angleRadians));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

export type GpsStatus =
  | "SEARCHING"
  | "ACTIVE"
  | "APPROXIMATE"
  | "SLOW"
  | "INACTIVE"
  | "DENIED"
  | "UNAVAILABLE";

export type GpsFailureKind =
  | "DENIED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "IMPRECISE"
  | "INSECURE_CONTEXT"
  | null;

/**
 * Single source of truth for the GPS badge shown in the driver UI.
 *
 * Priority order:
 * 1. Actively searching -> SEARCHING.
 * 2. Permission denied -> DENIED (a hard block, nothing else matters).
 * 3. Insecure context (plain HTTP on a non-localhost host) -> UNAVAILABLE, a
 *    hard block for the same reason: no retry can fix it from this page.
 * 4. Tracking not active for this tour -> INACTIVE.
 * 5. A hard device/browser failure with no fallback position at all -> UNAVAILABLE.
 * 6. Otherwise, classify purely from how old/reliable the last known point is —
 *    a transient error (e.g. one timed-out fix) must not override a still-fresh
 *    position, since "no position" is always safer to report than a wrong one,
 *    but a real fresh position must not be hidden behind a stale error either.
 */
export function classifyGpsStatus({
  active,
  searching,
  failureKind,
  displayPosition,
  reliablePosition,
  latestPositionAt,
  now,
}: {
  active: boolean;
  searching: boolean;
  failureKind: GpsFailureKind;
  displayPosition: unknown | null;
  reliablePosition: unknown | null;
  latestPositionAt: string | null;
  now: number;
}): GpsStatus {
  if (searching) {
    return "SEARCHING";
  }

  if (failureKind === "DENIED") {
    return "DENIED";
  }

  if (failureKind === "INSECURE_CONTEXT") {
    return "UNAVAILABLE";
  }

  if (!active) {
    return "INACTIVE";
  }

  if (!displayPosition && !latestPositionAt && (failureKind === "UNAVAILABLE" || failureKind === "TIMEOUT")) {
    return "UNAVAILABLE";
  }

  if (!latestPositionAt) {
    return "INACTIVE";
  }

  const ageMs = now - new Date(latestPositionAt).getTime();
  if (ageMs > GPS_INACTIVE_AFTER_MS) {
    return "INACTIVE";
  }

  if (ageMs > GPS_ACTIVE_MAX_AGE_MS) {
    return "SLOW";
  }

  if (reliablePosition) {
    return "ACTIVE";
  }

  if (displayPosition) {
    return "APPROXIMATE";
  }

  return "UNAVAILABLE";
}

/**
 * The admin fleet-tracking status - VERT/ORANGE/ROUGE/GRIS in the product
 * spec. Deliberately a coarser view of the SAME rule as classifyGpsStatus
 * above (identical age thresholds, GPS_ACTIVE_MAX_AGE_MS / GPS_INACTIVE_AFTER_MS),
 * not a second GPS status system: the admin only ever sees what's already
 * durably recorded server-side (a TourLocationPing, which already passed
 * every capture-time reliability check - see recordDriverLocationForDriver),
 * so device-only states like SEARCHING/DENIED/UNAVAILABLE have no meaning
 * from this vantage point. Only "how old is the last recorded point" does.
 */
export type FleetGpsStatus = "ACTIVE" | "SLOW" | "INACTIVE" | "NONE";

export function classifyFleetGpsStatus(
  lastPingAt: string | null,
  now: number = Date.now(),
): FleetGpsStatus {
  if (!lastPingAt) {
    return "NONE";
  }

  const ageMs = now - new Date(lastPingAt).getTime();
  if (ageMs > GPS_INACTIVE_AFTER_MS) {
    return "INACTIVE";
  }
  if (ageMs > GPS_ACTIVE_MAX_AGE_MS) {
    return "SLOW";
  }
  return "ACTIVE";
}

/**
 * A reported heading is only trustworthy while the vehicle is actually
 * moving - GPS-derived heading is essentially noise for a stationary/parked
 * truck. Reuses the same "effectively stationary" speed threshold already
 * applied to route display (GPS_DISPLAY_STATIONARY_SPEED_KMH), rather than
 * inventing a second one just for marker rotation.
 */
export function resolveReliableHeadingDegrees(
  heading: number | null | undefined,
  speedMetersPerSecond: number | null | undefined,
): number | null {
  if (heading === null || heading === undefined || !Number.isFinite(heading)) {
    return null;
  }

  if (speedMetersPerSecond !== null && speedMetersPerSecond !== undefined && Number.isFinite(speedMetersPerSecond)) {
    const speedKmh = speedMetersPerSecond * 3.6;
    if (speedKmh < GPS_DISPLAY_STATIONARY_SPEED_KMH) {
      return null;
    }
  }

  return heading;
}
