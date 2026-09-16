"use client";

import { withDatabase } from "./database";

export type OfflineCacheDiagnostics = {
  organizationId: string;
  driverId: string;
  productsCount: number;
  customersCount: number;
  stockRowsCount: number;
  lastSyncedAt: string | null;
};

/**
 * CORRECTION - "13. DONNÉES DE DIAGNOSTIC": read-only row counts for this
 * (organizationId, driverId), straight from SQLite - never full customer/
 * product rows (no PII), just enough to tell "the write never happened",
 * "the write happened but for a different org/driver", and "the write
 * happened correctly" apart on a real device without ADB. Never surfaced in
 * production UI - console.log only, matching this module's own existing
 * convention (bootstrap.ts already logs unconditionally, not gated behind a
 * DEV flag - this is diagnostic counts, not user data).
 */
export async function getOfflineCacheDiagnostics(scope: {
  organizationId: string;
  driverId: string;
}): Promise<OfflineCacheDiagnostics> {
  const [productsCount, customersCount, stockRowsCount, lastSyncedAt] = await Promise.all([
    countRows("cached_products", scope),
    countRows("cached_customers", scope),
    countRows("cached_truck_stock", scope),
    readLastSyncedAt(scope),
  ]);
  return {
    organizationId: scope.organizationId,
    driverId: scope.driverId,
    productsCount,
    customersCount,
    stockRowsCount,
    lastSyncedAt,
  };
}

async function countRows(table: string, scope: { organizationId: string; driverId: string }): Promise<number> {
  const rows = await withDatabase(async (db) => {
    // Table name never comes from input - always one of the three literals
    // above, so this is safe despite not being parameterizable in SQLite.
    const result = await db.query(
      `SELECT COUNT(*) as count FROM ${table} WHERE organizationId = ? AND driverId = ?`,
      [scope.organizationId, scope.driverId],
    );
    return result.values ?? [];
  });
  if (!rows || rows.length === 0) return 0;
  return Number(rows[0].count ?? 0);
}

async function readLastSyncedAt(scope: { organizationId: string; driverId: string }): Promise<string | null> {
  const rows = await withDatabase(async (db) => {
    const result = await db.query(
      `SELECT syncedAt FROM offline_context WHERE id = 1 AND organizationId = ? AND driverId = ?`,
      [scope.organizationId, scope.driverId],
    );
    return result.values ?? [];
  });
  if (!rows || rows.length === 0) return null;
  return (rows[0].syncedAt as string | null) ?? null;
}
