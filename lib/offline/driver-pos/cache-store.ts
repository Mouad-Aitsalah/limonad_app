"use client";

import { nowIso, withDatabase, withTransaction } from "./database";
import type { CachedCustomer, CachedProduct, CachedTruckStock } from "./types";

type Scope = { organizationId: string; driverId: string };

/**
 * Replaces every cached product for this (organizationId, driverId) with
 * the given list, in one transaction - a pure reference-data mirror, so a
 * full delete-then-insert is simpler and safer than a diff/upsert and can
 * never leave a stale product behind from a previous sync.
 */
export async function saveCachedProducts(
  scope: Scope,
  products: Array<Omit<CachedProduct, "organizationId" | "driverId" | "syncedAt">>,
): Promise<boolean> {
  const syncedAt = nowIso();
  const result = await withTransaction(async (db) => {
    await db.run(
      `DELETE FROM cached_products WHERE organizationId = ? AND driverId = ?`,
      [scope.organizationId, scope.driverId],
      false,
    );
    for (const product of products) {
      await db.run(
        `INSERT INTO cached_products (
           id, organizationId, driverId, reference, barcode, name, imageUrl,
           salePriceHT, salePriceTTC, taxRate, availableQuantity,
           supplierId, supplierName, priceToken, syncedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.id,
          scope.organizationId,
          scope.driverId,
          product.reference,
          product.barcode,
          product.name,
          product.imageUrl,
          product.salePriceHT,
          product.salePriceTTC,
          product.taxRate,
          product.availableQuantity,
          product.supplierId,
          product.supplierName,
          product.priceToken,
          syncedAt,
        ],
        false,
      );
    }
  });
  return result.ok;
}

export async function getCachedProducts(scope: Scope): Promise<CachedProduct[]> {
  const rows = await queryRows(
    `SELECT * FROM cached_products WHERE organizationId = ? AND driverId = ?`,
    [scope.organizationId, scope.driverId],
  );
  return rows.map(mapProductRow);
}

export async function saveCachedCustomers(
  scope: Scope,
  customers: Array<Omit<CachedCustomer, "organizationId" | "driverId" | "syncedAt">>,
): Promise<boolean> {
  const syncedAt = nowIso();
  const result = await withTransaction(async (db) => {
    await db.run(
      `DELETE FROM cached_customers WHERE organizationId = ? AND driverId = ?`,
      [scope.organizationId, scope.driverId],
      false,
    );
    for (const customer of customers) {
      await db.run(
        `INSERT INTO cached_customers (id, organizationId, driverId, code, name, phone, status, syncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer.id,
          scope.organizationId,
          scope.driverId,
          customer.code,
          customer.name,
          customer.phone,
          customer.status,
          syncedAt,
        ],
        false,
      );
    }
  });
  return result.ok;
}

export async function getCachedCustomers(scope: Scope): Promise<CachedCustomer[]> {
  const rows = await queryRows(
    `SELECT * FROM cached_customers WHERE organizationId = ? AND driverId = ?`,
    [scope.organizationId, scope.driverId],
  );
  return rows.map(mapCustomerRow);
}

export async function saveCachedTruckStock(
  scope: Scope & { truckId: string },
  stock: Array<Pick<CachedTruckStock, "productId" | "quantity" | "reservedQuantity" | "availableQuantity">>,
): Promise<boolean> {
  const lastSyncedAt = nowIso();
  const result = await withTransaction(async (db) => {
    await db.run(
      `DELETE FROM cached_truck_stock WHERE organizationId = ? AND driverId = ?`,
      [scope.organizationId, scope.driverId],
      false,
    );
    for (const line of stock) {
      await db.run(
        `INSERT INTO cached_truck_stock (
           productId, organizationId, driverId, truckId,
           quantity, reservedQuantity, availableQuantity, lastSyncedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          line.productId,
          scope.organizationId,
          scope.driverId,
          scope.truckId,
          line.quantity,
          line.reservedQuantity,
          line.availableQuantity,
          lastSyncedAt,
        ],
        false,
      );
    }
  });
  return result.ok;
}

export async function getCachedTruckStock(scope: Scope): Promise<CachedTruckStock[]> {
  const rows = await queryRows(
    `SELECT * FROM cached_truck_stock WHERE organizationId = ? AND driverId = ?`,
    [scope.organizationId, scope.driverId],
  );
  return rows.map(mapStockRow);
}

// --- internal helpers -------------------------------------------------

async function queryRows(
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  const rows = await withDatabase(async (db) => {
    const result = await db.query(sql, params);
    return result.values ?? [];
  });
  return rows ?? [];
}

function mapProductRow(row: Record<string, unknown>): CachedProduct {
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    driverId: String(row.driverId),
    reference: String(row.reference),
    barcode: (row.barcode as string | null) ?? null,
    name: String(row.name),
    imageUrl: (row.imageUrl as string | null) ?? null,
    salePriceHT: Number(row.salePriceHT),
    salePriceTTC: Number(row.salePriceTTC),
    taxRate: Number(row.taxRate),
    availableQuantity: Number(row.availableQuantity),
    supplierId: (row.supplierId as string | null) ?? null,
    supplierName: (row.supplierName as string | null) ?? null,
    priceToken: (row.priceToken as string | null) ?? null,
    syncedAt: String(row.syncedAt),
  };
}

function mapCustomerRow(row: Record<string, unknown>): CachedCustomer {
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    driverId: String(row.driverId),
    code: String(row.code),
    name: String(row.name),
    phone: (row.phone as string | null) ?? null,
    status: String(row.status),
    syncedAt: String(row.syncedAt),
  };
}

function mapStockRow(row: Record<string, unknown>): CachedTruckStock {
  return {
    productId: String(row.productId),
    organizationId: String(row.organizationId),
    driverId: String(row.driverId),
    truckId: String(row.truckId),
    quantity: Number(row.quantity),
    reservedQuantity: Number(row.reservedQuantity),
    availableQuantity: Number(row.availableQuantity),
    lastSyncedAt: String(row.lastSyncedAt),
  };
}
