"use client";

import { nowIso, withDatabase, withTransaction } from "./database";
import type { OfflineSale, OfflineSaleInput, OfflineSaleWithLines } from "./types";

/**
 * Phase 1: this creates a LOCAL row only - it never talks to the server.
 * The atomic write (sale + lines + truck-stock decrement + outbox entry)
 * mirrors what the eventual real offline-sale flow will need, so a later
 * phase can wire the real "Valider" button to this same function instead of
 * inventing a second offline-write path.
 *
 * All four steps run inside ONE SQLite transaction (see withTransaction):
 * if any insert/update fails, everything is rolled back and nothing is
 * left half-written - see this task's own "13. TRANSACTIONS LOCALES".
 */
export async function createOfflineSale(
  input: OfflineSaleInput,
): Promise<{ ok: true; localId: string } | { ok: false; error: unknown }> {
  const localId = crypto.randomUUID();
  const createdAtLocal = nowIso();

  const result = await withTransaction(async (db) => {
    await db.run(
      `INSERT INTO offline_sales (
         localId, clientMutationId, organizationId, driverId, truckId, tourId,
         stockLocationId, customerId, paymentMethod, syncStatus, soldAt,
         createdAtLocal, syncedAt, serverSaleId, officialDisplayNumber,
         subtotalHT, taxAmount, totalTTC, paidAmount, creditAmount,
         syncAttempts, lastSyncError
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SYNC', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, 0, NULL)`,
      [
        localId,
        input.clientMutationId,
        input.organizationId,
        input.driverId,
        input.truckId,
        input.tourId,
        input.stockLocationId,
        input.customerId,
        input.paymentMethod,
        input.soldAt,
        createdAtLocal,
        input.subtotalHT,
        input.taxAmount,
        input.totalTTC,
        input.paidAmount,
        input.creditAmount,
      ],
      false,
    );

    for (const line of input.lines) {
      await db.run(
        `INSERT INTO offline_sale_lines (
           id, offlineSaleId, productId, productNameSnapshot, quantity,
           unitPriceSnapshot, taxRateSnapshot, discountSnapshot,
           totalHT, taxAmount, totalTTC
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          localId,
          line.productId,
          line.productNameSnapshot,
          line.quantity,
          line.unitPriceSnapshot,
          line.taxRateSnapshot,
          line.discountSnapshot,
          line.totalHT,
          line.taxAmount,
          line.totalTTC,
        ],
        false,
      );

      // Truck stock is allowed to go negative (see schema.ts) - a plain
      // decrement, never clamped at 0, matching the server's own rule.
      await db.run(
        `UPDATE cached_truck_stock
           SET quantity = quantity - ?,
               availableQuantity = availableQuantity - ?
         WHERE organizationId = ? AND driverId = ? AND productId = ?`,
        [line.quantity, line.quantity, input.organizationId, input.driverId, line.productId],
        false,
      );
    }

    await db.run(
      `INSERT INTO sync_outbox (
         id, entityType, entityLocalId, operation, createdAt,
         attemptCount, nextAttemptAt, lastError, lockedAt
       ) VALUES (?, 'DRIVER_SALE', ?, 'CREATE', ?, 0, NULL, NULL, NULL)`,
      [crypto.randomUUID(), localId, createdAtLocal],
      false,
    );

    return localId;
  });

  return result.ok ? { ok: true, localId: result.value } : { ok: false, error: result.error };
}

export async function getOfflineSales(scope: {
  organizationId: string;
  driverId: string;
}): Promise<OfflineSaleWithLines[]> {
  const sales = await withDatabase(async (db) => {
    const result = await db.query(
      `SELECT * FROM offline_sales WHERE organizationId = ? AND driverId = ? ORDER BY createdAtLocal DESC`,
      [scope.organizationId, scope.driverId],
    );
    return result.values ?? [];
  });
  if (!sales || sales.length === 0) return [];

  const parsedSales = sales.map(mapSaleRow);
  const localReferenceById = buildLocalReferences(parsedSales);

  const withLines: OfflineSaleWithLines[] = [];
  for (const sale of parsedSales) {
    const lineRows = await withDatabase(async (db) => {
      const result = await db.query(`SELECT * FROM offline_sale_lines WHERE offlineSaleId = ?`, [
        sale.localId,
      ]);
      return result.values ?? [];
    });
    withLines.push({
      ...sale,
      localReference: localReferenceById.get(sale.localId) ?? sale.localId,
      lines: (lineRows ?? []).map((line) => ({
        id: String(line.id),
        offlineSaleId: String(line.offlineSaleId),
        productId: String(line.productId),
        productNameSnapshot: String(line.productNameSnapshot),
        quantity: Number(line.quantity),
        unitPriceSnapshot: Number(line.unitPriceSnapshot),
        taxRateSnapshot: Number(line.taxRateSnapshot),
        discountSnapshot: Number(line.discountSnapshot),
        totalHT: Number(line.totalHT),
        taxAmount: Number(line.taxAmount),
        totalTTC: Number(line.totalTTC),
      })),
    });
  }
  return withLines;
}

/**
 * Number of local sales still awaiting a future sync - the "N ventes en
 * attente" counter (see driver-pos-view.tsx's network badge). Sourced
 * straight from SQLite, never from in-memory state, so it survives a
 * remount/app-switch exactly like the sales themselves (see this task's own
 * "TEST C").
 */
export async function countPendingOfflineSales(scope: {
  organizationId: string;
  driverId: string;
}): Promise<number> {
  const rows = await withDatabase(async (db) => {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM offline_sales WHERE organizationId = ? AND driverId = ? AND syncStatus = 'PENDING_SYNC'`,
      [scope.organizationId, scope.driverId],
    );
    return result.values ?? [];
  });
  if (!rows || rows.length === 0) return 0;
  return Number(rows[0].count ?? 0);
}

/**
 * "OFF-YYYYMMDD-NNNN" - a local-only display reference, never an official
 * invoice number (see this task's own "20. NUMÉROTATION"). Derived here at
 * read time instead of a persisted column: NNNN is just this sale's rank,
 * ascending, among this device's own offline sales made on the same local
 * calendar day (from createdAtLocal) - stable as long as sales aren't
 * deleted, and needs no schema change / ALTER TABLE on already-provisioned
 * devices.
 */
function buildLocalReferences(sales: OfflineSale[]): Map<string, string> {
  const byDay = new Map<string, OfflineSale[]>();
  for (const sale of sales) {
    const day = formatLocalDay(sale.createdAtLocal);
    const list = byDay.get(day);
    if (list) list.push(sale);
    else byDay.set(day, [sale]);
  }

  const referenceById = new Map<string, string>();
  for (const [day, daySales] of byDay) {
    // `sales` (and therefore each `daySales`) comes in from a
    // `ORDER BY createdAtLocal DESC` query - reverse to assign 0001 to the
    // earliest sale of the day.
    const ascending = [...daySales].reverse();
    ascending.forEach((sale, index) => {
      referenceById.set(sale.localId, `OFF-${day}-${String(index + 1).padStart(4, "0")}`);
    });
  }
  return referenceById;
}

function formatLocalDay(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function mapSaleRow(row: Record<string, unknown>): OfflineSale {
  return {
    localId: String(row.localId),
    clientMutationId: String(row.clientMutationId),
    organizationId: String(row.organizationId),
    driverId: String(row.driverId),
    truckId: (row.truckId as string | null) ?? null,
    tourId: (row.tourId as string | null) ?? null,
    stockLocationId: (row.stockLocationId as string | null) ?? null,
    customerId: (row.customerId as string | null) ?? null,
    paymentMethod: row.paymentMethod as OfflineSale["paymentMethod"],
    syncStatus: row.syncStatus as OfflineSale["syncStatus"],
    soldAt: String(row.soldAt),
    createdAtLocal: String(row.createdAtLocal),
    syncedAt: (row.syncedAt as string | null) ?? null,
    serverSaleId: (row.serverSaleId as string | null) ?? null,
    officialDisplayNumber: (row.officialDisplayNumber as string | null) ?? null,
    subtotalHT: Number(row.subtotalHT),
    taxAmount: Number(row.taxAmount),
    totalTTC: Number(row.totalTTC),
    paidAmount: Number(row.paidAmount),
    creditAmount: Number(row.creditAmount),
    syncAttempts: Number(row.syncAttempts),
    lastSyncError: (row.lastSyncError as string | null) ?? null,
  };
}
