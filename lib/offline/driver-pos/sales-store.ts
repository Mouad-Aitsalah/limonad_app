"use client";

import { nowIso, withDatabase, withTransaction } from "./database";
import type { OfflineSale, OfflineSaleInput, OfflineSaleWithLines } from "./types";

/**
 * BUG CRITIQUE PHASE 3 bug hunt: crypto.randomUUID() is already used
 * elsewhere in this app (idempotencyKeyRef, accounting entries, credit
 * notes, ...) so it is very unlikely to be missing on a real device, but
 * this is still the one thing standing between "no ids at all" and every
 * insert below - a silent ReferenceError here would abort createOfflineSale
 * before it even reaches SQLite. Falls back to crypto.getRandomValues, then
 * (logged once, and only once) to Math.random - never Date.now() alone,
 * which collides across sales made in the same millisecond.
 */
let warnedUuidFallback = false;
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (!warnedUuidFallback) {
    warnedUuidFallback = true;
    console.warn(
      "[OFFLINE SALE] crypto.randomUUID unavailable on this WebView - falling back to a manual UUID v4",
    );
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Best-effort human-readable message from whatever a native plugin
 *  rejection actually is - a real Error, a plain `{message}` object (how
 *  Capacitor's Android bridge often rejects), a bare string, or something
 *  else entirely. Never throws itself. */
export function describeOfflineSaleError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Expected columns per table, hand-kept in sync with schema.ts - used only
 * by diagnoseOfflineSalesSchema() below to compare against what is ACTUALLY
 * installed on a given device (CREATE TABLE IF NOT EXISTS never retrofits an
 * already-existing table, so a device that first installed an older build
 * could in principle be missing a column schema.ts has since gained).
 */
const EXPECTED_OFFLINE_SCHEMA_COLUMNS: Record<string, string[]> = {
  offline_sales: [
    "localId", "clientMutationId", "organizationId", "driverId", "truckId", "tourId",
    "stockLocationId", "customerId", "paymentMethod", "syncStatus", "soldAt",
    "createdAtLocal", "syncedAt", "serverSaleId", "officialDisplayNumber",
    "subtotalHT", "taxAmount", "totalTTC", "paidAmount", "creditAmount",
    "syncAttempts", "lastSyncError",
  ],
  offline_sale_lines: [
    "id", "offlineSaleId", "productId", "productNameSnapshot", "quantity",
    "unitPriceSnapshot", "taxRateSnapshot", "discountSnapshot", "totalHT", "taxAmount", "totalTTC",
  ],
  sync_outbox: [
    "id", "entityType", "entityLocalId", "operation", "createdAt",
    "attemptCount", "nextAttemptAt", "lastError", "lockedAt",
  ],
  cached_truck_stock: [
    "productId", "organizationId", "driverId", "truckId", "quantity",
    "reservedQuantity", "availableQuantity", "lastSyncedAt",
  ],
};

/**
 * TEMPORARY (Phase 3 bug hunt) - reads PRAGMA table_info for every table
 * createOfflineSale touches and logs any column the ACTUAL device schema is
 * missing (or has extra) compared to schema.ts's current shape. Read-only,
 * safe to call any time; called automatically on a createOfflineSale
 * failure (see below) so a single failed sale attempt already carries this
 * in the console without a separate manual step.
 */
export async function diagnoseOfflineSalesSchema(): Promise<void> {
  for (const [table, expectedColumns] of Object.entries(EXPECTED_OFFLINE_SCHEMA_COLUMNS)) {
    const rows = await withDatabase(async (db) => {
      // Table names can't be bound as `?` params in SQLite - safe here only
      // because `table` comes from the hardcoded map above, never from input.
      const result = await db.query(`PRAGMA table_info(${table})`);
      return result.values ?? [];
    });
    if (rows === null) {
      console.error(`[OFFLINE SALE][SCHEMA] ${table}: could not read (SQLite unavailable)`);
      continue;
    }
    const actualColumns = rows.map((row) => String(row.name));
    const missing = expectedColumns.filter((col) => !actualColumns.includes(col));
    const extra = actualColumns.filter((col) => !expectedColumns.includes(col));
    if (missing.length > 0 || rows.length === 0) {
      console.error(`[OFFLINE SALE][SCHEMA] ${table}: MISMATCH`, { actualColumns, missing, extra });
    } else {
      console.log(`[OFFLINE SALE][SCHEMA] ${table}: ok`, { actualColumns });
    }
  }
}

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
 *
 * BUG CRITIQUE PHASE 3 bug hunt: every step now logs before/after, and a
 * `step` marker is kept live so a failure - wherever it happens - is
 * reported with the exact step it happened at, the exact plugin error, and
 * enough non-secret context (localId/organizationId/driverId) to reproduce
 * it, instead of the generic catch-all this used to be.
 */
export async function createOfflineSale(
  input: OfflineSaleInput,
): Promise<{ ok: true; localId: string } | { ok: false; error: unknown }> {
  const localId = generateUuid();
  const createdAtLocal = nowIso();
  let step = "begin";

  console.log("[OFFLINE SALE] begin", {
    localId,
    organizationId: input.organizationId,
    driverId: input.driverId,
    truckId: input.truckId,
    lineCount: input.lines.length,
  });

  const result = await withTransaction(async (db) => {
    step = "insert sale";
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
    console.log("[OFFLINE SALE] insert sale ok", { localId });

    for (const line of input.lines) {
      step = `insert line (${line.productId})`;
      await db.run(
        `INSERT INTO offline_sale_lines (
           id, offlineSaleId, productId, productNameSnapshot, quantity,
           unitPriceSnapshot, taxRateSnapshot, discountSnapshot,
           totalHT, taxAmount, totalTTC
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUuid(),
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

      // Diagnostic only - confirms whether this device's cache actually has
      // a truck-stock row for this product BEFORE the decrement below runs.
      // Never invents a row: a missing one means the UPDATE that follows
      // will affect 0 rows, which is now a hard, explicit error rather than
      // a silent no-op (see "7. VÉRIFIER UPDATE STOCK").
      const stockRows = await db.query(
        `SELECT quantity FROM cached_truck_stock WHERE organizationId = ? AND driverId = ? AND productId = ?`,
        [input.organizationId, input.driverId, line.productId],
      );
      const stockRow = (stockRows.values ?? [])[0] as { quantity?: number } | undefined;
      console.log("[OFFLINE SALE] stock lookup", {
        productId: line.productId,
        found: Boolean(stockRow),
        quantity: stockRow?.quantity ?? null,
      });

      step = `update stock (${line.productId})`;
      // Truck stock is allowed to go negative (see schema.ts) - a plain
      // decrement, never clamped at 0, matching the server's own rule.
      const updateResult = await db.run(
        `UPDATE cached_truck_stock
           SET quantity = quantity - ?,
               availableQuantity = availableQuantity - ?
         WHERE organizationId = ? AND driverId = ? AND productId = ?`,
        [line.quantity, line.quantity, input.organizationId, input.driverId, line.productId],
        false,
      );
      const changedRows = updateResult.changes?.changes ?? 0;
      if (changedRows === 0) {
        // Never a silent "sale saved, stock just didn't move" - see "7.
        // VÉRIFIER UPDATE STOCK". A future phase can decide to soft-recover
        // from this (e.g. insert a fresh 0-quantity row); today it must
        // surface loudly instead of hiding a cache gap.
        throw new Error(`LOCAL_STOCK_NOT_FOUND:${line.productId}`);
      }
    }
    console.log("[OFFLINE SALE] insert lines + update stock ok", { lineCount: input.lines.length });

    step = "insert outbox";
    await db.run(
      `INSERT INTO sync_outbox (
         id, entityType, entityLocalId, operation, createdAt,
         attemptCount, nextAttemptAt, lastError, lockedAt
       ) VALUES (?, 'DRIVER_SALE', ?, 'CREATE', ?, 0, NULL, NULL, NULL)`,
      [generateUuid(), localId, createdAtLocal],
      false,
    );
    console.log("[OFFLINE SALE] insert outbox ok", { localId });

    step = "commit";
    return localId;
  });

  if (!result.ok) {
    console.error("[OFFLINE SALE] failed", {
      step,
      message: describeOfflineSaleError(result.error),
      localId,
      organizationId: input.organizationId,
      driverId: input.driverId,
    });
    // Read-only and safe - always run on failure so the schema comparison
    // is already in the log without asking for a second repro.
    void diagnoseOfflineSalesSchema();
  } else {
    console.log("[OFFLINE SALE] commit ok", { localId });
  }

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
