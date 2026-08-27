/**
 * Single source of truth for every GPS threshold used by COMDIS.
 *
 * A position is never treated as "current" once it falls outside these
 * windows — see gps-utils.ts for how they're applied.
 */

/** A point younger than this is fresh enough to be a reliable "current position". */
export const GPS_ACTIVE_MAX_AGE_MS = 45_000;

/** A point older than this is no longer usable at all, even for display. */
export const GPS_INACTIVE_AFTER_MS = 120_000;

/** accuracy <= this => reliable (used for proximity, distance, "ACTIVE" status). */
export const GPS_GOOD_ACCURACY_METERS = 100;

/** accuracy <= this => usable for map display ("APPROXIMATE"), never for proximity. */
export const GPS_MAX_USABLE_ACCURACY_METERS = 500;

/** @deprecated use GPS_GOOD_ACCURACY_METERS */
export const GPS_MAX_ACCURACY_METERS = GPS_GOOD_ACCURACY_METERS;

/** Gap between two consecutive points beyond which a route segment breaks. */
export const GPS_GAP_MS = 120_000;

/** Implied speed beyond which two points can't belong to the same segment. */
export const GPS_MAX_TRUCK_SPEED_KMH = 150;

/** Tolerance for clock drift when a device reports a timestamp slightly in the future. */
export const GPS_MAX_FUTURE_DRIFT_MS = 30_000;

/** Maximum distance from a stop's anchor point before the truck is considered to have left that stop zone. */
export const GPS_STOP_RADIUS_METERS = 30;

/** Leaving a stop needs a larger radius than entering it, to absorb GPS oscillation around the edge. */
export const GPS_STOP_EXIT_RADIUS_METERS = 45;

/** Minimum number of consecutive outside points required before a stop is really considered finished. */
export const GPS_STOP_EXIT_CONFIRMATION_POINTS = 2;

/** Minimum dwell time inside a stop zone before it is promoted to a real stop. */
export const GPS_STOP_MIN_DURATION_MS = 120_000;

/**
 * A last stop can stay "active" for a short period after the latest GPS point,
 * so brief radio/browser hiccups do not instantly close it. Beyond this grace
 * window, the stop is frozen at its last real point to avoid fake huge stops.
 */
export const GPS_STOP_ACTIVE_GRACE_MS = 300_000;

/** Minimum time between two location pushes to the server (unless GPS_LOCATION_PUSH_MIN_DISTANCE_METERS is exceeded). */
export const GPS_LOCATION_PUSH_MIN_DELAY_MS = 15_000;

/** Minimum displacement between two location pushes to the server (unless GPS_LOCATION_PUSH_MIN_DELAY_MS has elapsed). */
export const GPS_LOCATION_PUSH_MIN_DISTANCE_METERS = 20;

/**
 * Display-only route cleanup:
 * small moves below this are usually just handheld/browser drift and do not
 * deserve a visible bend on the rendered truck path.
 */
export const GPS_DISPLAY_MIN_MOVEMENT_METERS = 12;

/**
 * Accuracy-aware display filtering may raise the movement threshold, but it is
 * capped so slow real movement is still allowed to appear eventually.
 */
export const GPS_DISPLAY_MAX_MOVEMENT_METERS = 22;

/** Larger accuracy means the point must move farther before it changes the displayed path. */
export const GPS_DISPLAY_ACCURACY_DISTANCE_FACTOR = 0.6;

/** When the truck is effectively stationary, be even more conservative with drift. */
export const GPS_DISPLAY_STATIONARY_ACCURACY_FACTOR = 0.75;

/** A reported/derived speed at or below this is considered effectively stationary for display. */
export const GPS_DISPLAY_STATIONARY_SPEED_KMH = 4;

/** Light geometric simplification tolerance applied only to the rendered path. */
export const GPS_DISPLAY_SIMPLIFICATION_TOLERANCE_METERS = 6;

/** Strong direction changes above this angle are preserved even after simplification. */
export const GPS_DISPLAY_TURN_ANGLE_DEGREES = 18;

/**
 * Map-only fallback center (Casablanca), used solely to give a Leaflet
 * MapContainer something to render before any real position is known.
 *
 * MUST NEVER be assigned to a driver/current-position variable — it is not
 * a GPS reading and must not be sent to the server or used for distance,
 * proximity, or route calculations.
 */
export const DEFAULT_MAP_CENTER: [number, number] = [33.5731, -7.5898];
