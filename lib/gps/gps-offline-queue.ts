"use client";

import { Preferences } from "@capacitor/preferences";

import { CLIENT_PING_ID_PATTERN } from "@/lib/gps/gps-utils";
import type { QueuedGpsPoint } from "@/types/gps-offline";

/**
 * Phase 5B - the single durable GPS queue, shared by the web/foreground path
 * and the native background-plugin JS callback.
 *
 * Storage: @capacitor/preferences. On a device it is a real native key/value
 * store (Android SharedPreferences), so the queue survives page navigation,
 * app close/reopen, network loss and an ordinary JS crash. In a plain
 * browser it transparently falls back to localStorage - good enough for
 * Preview/dev, and it means there is only ONE queue abstraction to reason
 * about. SQLite was deliberately not pulled in: the payload is a bounded
 * array of tiny records, not a relational workload.
 *
 * NOTE: it does NOT survive the OS killing the process or a reboot while the
 * app is closed - the JS that writes here is not running then. That is an
 * explicit non-goal of 5B (see the phase report). 5B guarantees: app alive +
 * network cut -> no point lost.
 */

const QUEUE_KEY = "comdis.gps.pendingQueue.v1";

/**
 * Hard cap. ~1 point / 15-30 s over a very long day stays well under this.
 * On overflow we keep the NEWEST points and drop the oldest - never the
 * reverse. The drop count is returned so the caller can surface it.
 */
export const GPS_QUEUE_MAX_POINTS = 5_000;

// Serialises every read-modify-write so two concurrent enqueue/remove calls
// can't clobber each other (Preferences has no atomic update).
let mutex: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn);
  mutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readRaw(): Promise<QueuedGpsPoint[]> {
  try {
    const { value } = await Preferences.get({ key: QUEUE_KEY });
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as QueuedGpsPoint[]).filter(isStorable) : [];
  } catch {
    return [];
  }
}

async function writeRaw(points: QueuedGpsPoint[]): Promise<void> {
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(points) });
}

function byCapturedAt(a: QueuedGpsPoint, b: QueuedGpsPoint) {
  return Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
}

export function isStorable(point: unknown): point is QueuedGpsPoint {
  if (!point || typeof point !== "object") return false;
  const p = point as Partial<QueuedGpsPoint>;
  if (typeof p.tourId !== "string" || p.tourId.length === 0 || p.tourId.length > 64) return false;
  if (typeof p.clientPingId !== "string" || !CLIENT_PING_ID_PATTERN.test(p.clientPingId)) return false;
  if (typeof p.latitude !== "number" || !Number.isFinite(p.latitude) || p.latitude < -90 || p.latitude > 90) {
    return false;
  }
  if (
    typeof p.longitude !== "number" ||
    !Number.isFinite(p.longitude) ||
    p.longitude < -180 ||
    p.longitude > 180
  ) {
    return false;
  }
  if (typeof p.capturedAt !== "string" || !Number.isFinite(Date.parse(p.capturedAt))) return false;
  return true;
}

/**
 * Persist points BEFORE any network attempt (record-first). Dedups by
 * clientPingId (a re-enqueue of the same fix just refreshes it). Returns the
 * new queue size and how many oldest points had to be dropped for the cap.
 */
export async function enqueueGpsPoints(
  points: QueuedGpsPoint[],
): Promise<{ size: number; dropped: number }> {
  const incoming = points.filter(isStorable);
  return withLock(async () => {
    const current = await readRaw();
    if (incoming.length === 0) return { size: current.length, dropped: 0 };

    const byId = new Map(current.map((p) => [p.clientPingId, p]));
    for (const p of incoming) byId.set(p.clientPingId, p);
    let next = [...byId.values()];

    let dropped = 0;
    if (next.length > GPS_QUEUE_MAX_POINTS) {
      next.sort(byCapturedAt);
      dropped = next.length - GPS_QUEUE_MAX_POINTS;
      next = next.slice(dropped); // keep the newest GPS_QUEUE_MAX_POINTS
    }

    await writeRaw(next);
    return { size: next.length, dropped };
  });
}

export function enqueueGpsPoint(point: QueuedGpsPoint) {
  return enqueueGpsPoints([point]);
}

/** Oldest-first, up to `limit`, filtered to `tourId` when given. */
export async function peekOldestGpsPoints(
  limit: number,
  tourId?: string,
): Promise<QueuedGpsPoint[]> {
  return withLock(async () => {
    const current = (await readRaw()).sort(byCapturedAt);
    const scoped = tourId ? current.filter((p) => p.tourId === tourId) : current;
    return scoped.slice(0, Math.max(0, limit));
  });
}

/** Drop every point that is NOT tagged with `keepTourId`. Returns drop count. */
export async function dropGpsPointsForOtherTours(keepTourId: string): Promise<number> {
  return withLock(async () => {
    const current = await readRaw();
    const next = current.filter((p) => p.tourId === keepTourId);
    if (next.length !== current.length) await writeRaw(next);
    return current.length - next.length;
  });
}

export async function removeGpsPoints(clientPingIds: string[]): Promise<number> {
  const remove = new Set(clientPingIds);
  return withLock(async () => {
    const current = await readRaw();
    if (remove.size === 0) return current.length;
    const next = current.filter((p) => !remove.has(p.clientPingId));
    if (next.length !== current.length) await writeRaw(next);
    return next.length;
  });
}

export async function gpsQueueSize(): Promise<number> {
  return withLock(async () => (await readRaw()).length);
}

export async function clearGpsQueue(): Promise<void> {
  return withLock(async () => {
    await Preferences.remove({ key: QUEUE_KEY });
  });
}
