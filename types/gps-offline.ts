/**
 * Phase 5B - the shape of a single GPS fix while it lives in the local
 * offline queue and while it travels in a batch to the server. Deliberately
 * tiny: coordinates + a phone-generated stable id + the real capture time.
 *
 * MUST NEVER carry a password, cookie, session, tracking token,
 * BACKGROUND_TRACKING_SECRET, email or any customer data. `tourId` is the
 * only identifier here - it is checked against the server-derived active
 * tour, never trusted for authorization.
 */
export type LocalGpsPoint = {
  /**
   * Phone-generated, stable for the life of this fix - identical on every
   * (re)send. The server dedups on (tourId, clientPingId), so a retried
   * batch never creates a duplicate row.
   */
  clientPingId: string;
  latitude: number;
  longitude: number;
  /** Meters. Optional - some sources don't report it. */
  accuracy?: number | null;
  /** m/s. Optional. */
  speed?: number | null;
  /** Degrees 0-360. Optional. */
  heading?: number | null;
  /** ISO-8601 - the instant the phone captured the fix, NOT the sync time. */
  capturedAt: string;
};

/**
 * A queued point, tagged with the tour it belongs to. Points whose tourId no
 * longer matches the active tour (tour ended while offline) are dropped by
 * the sync loop rather than mis-attached to a later tour.
 */
export type QueuedGpsPoint = LocalGpsPoint & { tourId: string };

/** POST /api/driver/tour/location/batch request body. */
export type GpsBatchRequest = {
  tourId: string;
  points: LocalGpsPoint[];
};

/** POST /api/driver/tour/location/batch response body. */
export type GpsBatchResult = {
  /** Rows actually inserted by this call. */
  accepted: number;
  /** Valid points the server already had (idempotent no-op). */
  duplicates: number;
  /** Points dropped by server-side validation. */
  rejected: number;
  /**
   * Every clientPingId from the request the server reached a final decision
   * on (inserted, duplicate, or rejected-as-invalid). The phone removes
   * exactly these from its queue and keeps everything else.
   */
  processedIds: string[];
};
