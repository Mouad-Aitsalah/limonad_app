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
  const localId = generateLocalId("sale");
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
          generateLocalId("line"),
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
       ) VALUES (?, 'offline_sale', ?, 'CREATE', ?, 0, NULL, NULL, NULL)`,
      [generateLocalId("outbox"), localId, createdAtLocal],
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

  const withLines: OfflineSaleWithLines[] = [];
  for (const row of sales) {
    const sale = mapSaleRow(row);
    const lineRows = await withDatabase(async (db) => {
      const result = await db.query(`SELECT * FROM offline_sale_lines WHERE offlineSaleId = ?`, [
        sale.localId,
      ]);
      return result.values ?? [];
    });
    withLines.push({
      ...sale,
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

let counter = 0;
function generateLocalId(prefix: string): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${counter}_${random}`;
}
