"use client";

/**
 * COUNTER POS - state of the reference-data synchronization (Phase 3).
 *
 * One row per (organization, user): the POS context - depot, bank accounts -
 * is per user, so its freshness is too. It answers the questions a future UI
 * (and the auto-sync) asks: when did the last SUCCESSFUL sync finish? did the
 * last attempt fail, and why? is one running? was the whole catalogue held?
 *
 * `lastSyncAt` only ever moves on a SUCCESS; a failure records the error and
 * leaves the previous good data - and the previous `lastSyncAt` - in place.
 */

import { assertScope, runStorage, toIso } from "./database";
import type {
  CounterPosScope,
  StoreResult,
  SyncErrorRecord,
  SyncStateRecord,
  SyncStatus,
  SyncSummary,
  SyncWarning,
} from "./schema";

/** A persisted SYNCING older than this was interrupted (tab closed, crash). */
export const SYNC_STALE_RUNNING_MS = 10 * 60 * 1000;

export function idleSyncState(scope: CounterPosScope, now: Date = new Date()): SyncStateRecord {
  return {
    organizationId: scope.organizationId,
    userId: scope.userId,
    status: "IDLE",
    startedAt: null,
    lastAttemptAt: null,
    lastSyncAt: null,
    lastError: null,
    warnings: [],
    lastSummary: null,
    catalogueComplete: false,
    customersComplete: false,
    updatedAt: toIso(now),
  };
}

/** The persisted state, or an IDLE one when this PC never synced for this
 *  user (NOT written: reading never modifies anything). */
export function getPosSyncState(
  scope: CounterPosScope,
  options: { now?: Date } = {},
): Promise<StoreResult<SyncStateRecord>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    return (
      (await db.syncStates.get([scope.organizationId, scope.userId])) ??
      idleSyncState(scope, options.now)
    );
  });
}

/** The status a UI should display: a SYNCING row that outlived
 *  SYNC_STALE_RUNNING_MS is reported as FAILED (interrupted), not as running
 *  forever. */
export function effectiveSyncStatus(state: SyncStateRecord, now: Date = new Date()): SyncStatus {
  if (state.status !== "SYNCING") return state.status;
  const started = state.startedAt ? new Date(state.startedAt).getTime() : Number.NEGATIVE_INFINITY;
  return now.getTime() - started > SYNC_STALE_RUNNING_MS ? "FAILED" : "SYNCING";
}

async function updateState(
  scope: CounterPosScope,
  now: Date,
  change: (previous: SyncStateRecord) => SyncStateRecord,
): Promise<StoreResult<SyncStateRecord>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    return db.transaction("rw", db.syncStates, async () => {
      const key: [string, string] = [scope.organizationId, scope.userId];
      const previous = (await db.syncStates.get(key)) ?? idleSyncState(scope, now);
      const next = { ...change(previous), updatedAt: toIso(now) };
      await db.syncStates.put(next);
      return next;
    });
  });
}

export function markPosSyncStarted(
  scope: CounterPosScope,
  now: Date = new Date(),
): Promise<StoreResult<SyncStateRecord>> {
  return updateState(scope, now, (previous) => ({
    ...previous,
    status: "SYNCING",
    startedAt: toIso(now),
    lastAttemptAt: toIso(now),
  }));
}

export function markPosSyncSucceeded(
  scope: CounterPosScope,
  result: {
    summary: SyncSummary;
    warnings: SyncWarning[];
    catalogueComplete: boolean;
    customersComplete: boolean;
  },
  now: Date = new Date(),
): Promise<StoreResult<SyncStateRecord>> {
  return updateState(scope, now, (previous) => ({
    ...previous,
    status: "SUCCESS",
    startedAt: null,
    lastAttemptAt: toIso(now),
    lastSyncAt: toIso(now),
    lastError: null,
    warnings: result.warnings,
    lastSummary: result.summary,
    catalogueComplete: result.catalogueComplete,
    customersComplete: result.customersComplete,
  }));
}

/** Records a failed attempt. The previous data, `lastSyncAt`, summary and
 *  completeness flags are deliberately KEPT: a failed sync must not make the
 *  POS forget what it last downloaded successfully. */
export function markPosSyncFailed(
  scope: CounterPosScope,
  error: Omit<SyncErrorRecord, "at">,
  now: Date = new Date(),
): Promise<StoreResult<SyncStateRecord>> {
  return updateState(scope, now, (previous) => ({
    ...previous,
    status: "FAILED",
    startedAt: null,
    lastAttemptAt: toIso(now),
    lastError: { ...error, at: toIso(now) },
  }));
}
