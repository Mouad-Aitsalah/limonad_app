"use client";

import {
  dropGpsPointsForOtherTours,
  peekOldestGpsPoints,
  removeGpsPoints,
} from "@/lib/gps/gps-offline-queue";
import type { GpsBatchResult, LocalGpsPoint } from "@/types/gps-offline";

/**
 * Phase 5B - drains the durable GPS queue to POST /api/driver/tour/location/batch.
 *
 * Guarantees:
 *  - only points for the CURRENTLY active tour are sent (a finished tour's
 *    leftovers are dropped, never mis-attached);
 *  - a batch is removed from the queue ONLY after the server confirms it
 *    (2xx + `processedIds`); any failure leaves the queue untouched;
 *  - one flush at a time; a throttle + capped exponential backoff keep this
 *    from turning into a hot loop on a flaky network.
 */

const BATCH_ENDPOINT = "/api/driver/tour/location/batch";
const BATCH_SIZE = 100;
const MAX_ITERATIONS_PER_FLUSH = 15;
const MIN_FLUSH_INTERVAL_MS = 8_000;
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export type GpsFlushOutcome =
  | "idle"
  | "drained"
  | "partial"
  | "retry-scheduled"
  | "no-tour"
  | "skipped";

let flushing = false;
let lastFlushAt = 0;
let backoffMs = BACKOFF_BASE_MS;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let resolveActiveTourId: (() => string | null) | null = null;

/** Called once by the driver runtime: how to read the currently active tour id. */
export function configureGpsSync(resolver: () => string | null): void {
  resolveActiveTourId = resolver;
}

/**
 * Phase 5C - stop the sync layer when a tour ends: cancel any pending
 * backoff retry so nothing keeps hitting the network for a finished tour.
 * The queue itself is left intact (a final flush should run first).
 */
export function stopGpsSync(): void {
  clearRetryTimer();
  backoffMs = BACKOFF_BASE_MS;
}

/**
 * Phase 5C - one last drain for a tour that is ending, addressed by its
 * explicit id (by now `resolveActiveTourId()` returns null). Best-effort:
 * if the network is down it simply no-ops and the points stay queued for
 * the next tour-scoped opportunity or eventual eviction.
 */
export function finalFlushForTour(tourId: string): Promise<GpsFlushOutcome> {
  return flushGpsQueue({ force: true, tourId });
}

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushGpsQueue({ force: true });
  }, delay);
}

export async function flushGpsQueue(
  opts: { force?: boolean; tourId?: string } = {},
): Promise<GpsFlushOutcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "skipped";
  if (flushing) return "skipped";

  const now = Date.now();
  if (!opts.force && now - lastFlushAt < MIN_FLUSH_INTERVAL_MS) return "skipped";

  // `opts.tourId` is the end-of-tour final-flush path (finalFlushForTour),
  // where the resolver already reports no active tour.
  const tourId = opts.tourId ?? resolveActiveTourId?.() ?? null;
  if (!tourId) return "no-tour";

  flushing = true;
  lastFlushAt = now;
  clearRetryTimer();
  try {
    await dropGpsPointsForOtherTours(tourId);

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_FLUSH; iteration += 1) {
      const batch = await peekOldestGpsPoints(BATCH_SIZE, tourId);
      if (batch.length === 0) {
        backoffMs = BACKOFF_BASE_MS;
        return iteration === 0 ? "idle" : "drained";
      }

      let response: Response;
      try {
        response = await fetch(BATCH_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            tourId,
            points: batch.map(
              (p): LocalGpsPoint => ({
                clientPingId: p.clientPingId,
                latitude: p.latitude,
                longitude: p.longitude,
                accuracy: p.accuracy ?? null,
                speed: p.speed ?? null,
                heading: p.heading ?? null,
                capturedAt: p.capturedAt,
              }),
            ),
          }),
        });
      } catch {
        scheduleRetry();
        return "retry-scheduled";
      }

      if (!response.ok) {
        scheduleRetry();
        return "retry-scheduled";
      }

      let result: GpsBatchResult;
      try {
        result = (await response.json()) as GpsBatchResult;
      } catch {
        scheduleRetry();
        return "retry-scheduled";
      }

      const processed = Array.isArray(result.processedIds) ? result.processedIds : [];
      if (processed.length === 0) {
        // Server took the request but told us to drop nothing - stop rather
        // than loop on the same batch.
        scheduleRetry();
        return "retry-scheduled";
      }

      await removeGpsPoints(processed);
      backoffMs = BACKOFF_BASE_MS;

      if (batch.length < BATCH_SIZE) return "drained";
    }

    return "partial";
  } finally {
    flushing = false;
  }
}
