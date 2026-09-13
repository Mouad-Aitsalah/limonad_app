"use client";

import { formatCustomerCode } from "@/lib/customer-code";
import type { CustomerDto, DriverPosContextDto, DriverPosProductDto } from "@/types/operations-dto";

import { getCachedCustomers, getCachedProducts, getCachedTruckStock } from "./cache-store";
import { getDriverOfflineContext } from "./context-store";
import { isDatabaseAvailable } from "./database";

export type CachedDriverPosContext = {
  context: DriverPosContextDto;
  /** offline_context.syncedAt - when this data was last mirrored from the server. */
  syncedAt: string;
};

/**
 * Tri-state result - see this task's own "8. CACHE ABSENT VS CACHE VIDE":
 * never collapse "SQLite itself is broken right now" and "no cache has ever
 * been written for this identity" into the same empty-looking value. A
 * caller must never treat ERROR the same as a legitimately empty catalogue.
 *
 *  - FOUND: a cached offline_context row exists for this exact
 *    (organizationId, driverId) - `context.products`/`customers` reflect
 *    whatever was actually cached, even if that happens to be empty (a real
 *    org with zero sellable products, for instance).
 *  - NOT_FOUND: SQLite is reachable, but there is no cached context row for
 *    this identity yet (first-ever load on this device, or a genuinely
 *    different driver's device).
 *  - ERROR: SQLite could not be opened/queried at all right now. The caller
 *    must keep whatever context it already has in memory - never replace it
 *    with this.
 */
export type CachedDriverPosContextResult =
  | {
      status: "FOUND";
      context: DriverPosContextDto;
      syncedAt: string;
      /** Raw per-table row counts, for the temporary dev cache diagnostic
       *  (see driver-pos-view.tsx) - independent of how the DTO merges them. */
      counts: { products: number; customers: number; stock: number };
    }
  | { status: "NOT_FOUND" }
  | { status: "ERROR" };

/**
 * Phase 2: reconstructs the SAME DriverPosContextDto shape the online
 * `GET /api/driver/pos` returns, but entirely from SQLite - so
 * driver-pos-view.tsx can render unchanged regardless of where the data
 * came from (see this task's own "3. NE PAS DUPLIQUER L'UI").
 *
 * Every read below is scoped to the exact (organizationId, driverId) given
 * here (see this task's "13. ISOLATION" / "15. CACHE D'UNE AUTRE IDENTITÉ"),
 * so a different driver's (or organisation's) cache on the same device can
 * never be returned.
 *
 * Fields the cache doesn't carry (Phase 1 only stored what the POS grid/
 * cart/picker actually read - see cache-store.ts's own doc comments) get a
 * safe, inert default:
 *  - `bankAccounts`: empty - BANK_TRANSFER can't be validated offline anyway
 *    (see driver-pos-view.tsx's offline block on validateSale/prepareInvoice).
 *  - `productsTruncated`: always false - the cache is the FULL known product
 *    list for this driver, never a bounded preload, so
 *    usePosProductSearch never needs (and offline never has) a server
 *    fallback search - see that hook's own doc comment.
 *  - Customer fields not cached (address, city, credit, ...): not read by
 *    the driver POS UI at all, so a neutral placeholder is fine here.
 */
export async function loadCachedDriverPosContext(params: {
  organizationId: string;
  driverId: string;
}): Promise<CachedDriverPosContextResult> {
  if (!(await isDatabaseAvailable())) {
    console.error("[OFFLINE CACHE] SQLite error", "database unavailable for read");
    return { status: "ERROR" };
  }

  const offlineContext = await getDriverOfflineContext(params);
  if (!offlineContext) {
    console.log("[OFFLINE CACHE] no cached context found for", {
      organizationId: params.organizationId,
      driverId: params.driverId,
    });
    return { status: "NOT_FOUND" };
  }

  const [products, customers, stock] = await Promise.all([
    getCachedProducts(params),
    getCachedCustomers(params),
    getCachedTruckStock(params),
  ]);

  console.log("[OFFLINE CACHE] products loaded", products.length);
  console.log("[OFFLINE CACHE] customers loaded", customers.length);
  console.log("[OFFLINE CACHE] stock loaded", stock.length);

  const stockByProductId = new Map(stock.map((row) => [row.productId, row]));

  const dtoProducts: DriverPosProductDto[] = products.map((product) => ({
    id: product.id,
    reference: product.reference,
    barcode: product.barcode,
    name: product.name,
    imageUrl: product.imageUrl,
    salePriceHT: product.salePriceHT,
    salePriceTTC: product.salePriceTTC,
    taxRate: product.taxRate,
    // The truck-stock table is the more current of the two once a future
    // phase starts decrementing it locally - cached_products.availableQuantity
    // (its own last-synced snapshot) is only the fallback.
    availableQuantity: stockByProductId.get(product.id)?.availableQuantity ?? product.availableQuantity,
    supplierId: product.supplierId,
    supplierName: product.supplierName,
    // PHASE 4A.1 - whatever this cache's last online refresh signed. Never
    // regenerated here (this module never talks to the server / never has
    // the signing secret) - null only for a cache written before this
    // column existed.
    priceToken: product.priceToken ?? undefined,
  }));

  const dtoCustomers: CustomerDto[] = customers.map((customer) => ({
    id: customer.id,
    code: customer.code,
    displayCode: formatCustomerCode(customer.code),
    name: customer.name,
    phone: customer.phone,
    address: "",
    city: "",
    type: "COUNTER",
    status: customer.status,
    creditLimit: 0,
    creditLimitEnabled: false,
    currentBalance: 0,
    createdByUserId: "",
    createdByUserName: "",
    creationOrigin: "ADMIN",
    createdAt: offlineContext.syncedAt,
    updatedAt: offlineContext.syncedAt,
  }));

  const context: DriverPosContextDto = {
    canSell: true,
    driver: { id: offlineContext.driverId, name: offlineContext.driverName },
    truck: offlineContext.truckId
      ? {
          id: offlineContext.truckId,
          code: offlineContext.truckName ?? "",
          registration: offlineContext.truckName ?? "",
        }
      : null,
    tour: offlineContext.tourId
      ? {
          id: offlineContext.tourId,
          code: offlineContext.tourCode ?? "",
          status: offlineContext.tourStatus ?? "",
        }
      : null,
    customers: dtoCustomers,
    products: dtoProducts,
    stockLocationId: offlineContext.stockLocationId,
    productsTruncated: false,
    bankAccounts: [],
  };

  return {
    status: "FOUND",
    context,
    syncedAt: offlineContext.syncedAt,
    counts: { products: products.length, customers: customers.length, stock: stock.length },
  };
}
