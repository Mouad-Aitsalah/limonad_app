"use client";

import { formatCustomerCode } from "@/lib/customer-code";
import type { CustomerDto, DriverPosContextDto, DriverPosProductDto } from "@/types/operations-dto";

import { getCachedCustomers, getCachedProducts, getCachedTruckStock } from "./cache-store";
import { getDriverOfflineContext } from "./context-store";

export type CachedDriverPosContext = {
  context: DriverPosContextDto;
  /** offline_context.syncedAt - when this data was last mirrored from the server. */
  syncedAt: string;
};

/**
 * Phase 2: reconstructs the SAME DriverPosContextDto shape the online
 * `GET /api/driver/pos` returns, but entirely from SQLite - so
 * driver-pos-view.tsx can render unchanged regardless of where the data
 * came from (see this task's own "3. NE PAS DUPLIQUER L'UI").
 *
 * Returns `null` when there is no usable cache for this exact
 * (organizationId, driverId) - see this task's "14. CACHE ABSENT" and
 * "15. CACHE D'UNE AUTRE IDENTITÉ": every read below is scoped to the pair
 * given here, so a different driver's (or organisation's) cache on the same
 * device can never be returned.
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
}): Promise<CachedDriverPosContext | null> {
  const offlineContext = await getDriverOfflineContext(params);
  if (!offlineContext) return null;

  const [products, customers, stock] = await Promise.all([
    getCachedProducts(params),
    getCachedCustomers(params),
    getCachedTruckStock(params),
  ]);

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

  return { context, syncedAt: offlineContext.syncedAt };
}
