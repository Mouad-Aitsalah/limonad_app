"use client";

import { nowIso, withDatabase } from "./database";
import type { DriverOfflineContext } from "./types";

/**
 * Replaces the single cached "who is this device logged in as" row. Called
 * by bootstrap.ts right after a successful online context fetch - never
 * from a React component directly.
 */
export async function saveDriverOfflineContext(
  context: Omit<DriverOfflineContext, "syncedAt">,
): Promise<boolean> {
  const result = await withDatabase(async (db) => {
    await db.run(
      `INSERT INTO offline_context (
         id, organizationId, organizationName, userId, userName,
         driverId, driverName, truckId, truckName, stockLocationId,
         tourId, tourCode, tourStatus, syncedAt
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         organizationId = excluded.organizationId,
         organizationName = excluded.organizationName,
         userId = excluded.userId,
         userName = excluded.userName,
         driverId = excluded.driverId,
         driverName = excluded.driverName,
         truckId = excluded.truckId,
         truckName = excluded.truckName,
         stockLocationId = excluded.stockLocationId,
         tourId = excluded.tourId,
         tourCode = excluded.tourCode,
         tourStatus = excluded.tourStatus,
         syncedAt = excluded.syncedAt`,
      [
        context.organizationId,
        context.organizationName,
        context.userId,
        context.userName,
        context.driverId,
        context.driverName,
        context.truckId,
        context.truckName,
        context.stockLocationId,
        context.tourId,
        context.tourCode,
        context.tourStatus,
        nowIso(),
      ],
      false,
    );
    return true;
  });
  return result ?? false;
}

/**
 * Returns the cached context ONLY when it matches the given
 * organizationId/driverId - the isolation guarantee lives here, not in the
 * caller: a stale row left behind by a previous driver on a shared device
 * can never be handed back to whoever is asking under a different identity.
 */
export async function getDriverOfflineContext(params: {
  organizationId: string;
  driverId: string;
}): Promise<DriverOfflineContext | null> {
  const rows = await withDatabase(async (db) => {
    const result = await db.query(
      `SELECT * FROM offline_context WHERE id = 1 AND organizationId = ? AND driverId = ?`,
      [params.organizationId, params.driverId],
    );
    return result.values ?? [];
  });
  if (!rows || rows.length === 0) return null;
  return mapContextRow(rows[0]);
}

function mapContextRow(row: Record<string, unknown>): DriverOfflineContext {
  return {
    organizationId: String(row.organizationId),
    organizationName: (row.organizationName as string | null) ?? null,
    userId: String(row.userId),
    userName: String(row.userName),
    driverId: String(row.driverId),
    driverName: String(row.driverName),
    truckId: (row.truckId as string | null) ?? null,
    truckName: (row.truckName as string | null) ?? null,
    stockLocationId: (row.stockLocationId as string | null) ?? null,
    tourId: (row.tourId as string | null) ?? null,
    tourCode: (row.tourCode as string | null) ?? null,
    tourStatus: (row.tourStatus as string | null) ?? null,
    syncedAt: String(row.syncedAt),
  };
}
