"use client";

import { saveCachedCustomers, saveCachedProducts, saveCachedTruckStock } from "./cache-store";
import { saveDriverOfflineContext } from "./context-store";
import type { DriverPosContextDto } from "@/types/operations-dto";

export type HydrateDriverOfflineCacheInput = {
  /** Not on DriverPosContextDto (a driver only ever has one org) - comes
   *  from the authenticated session (see hooks/use-auth.tsx's CurrentUser). */
  organizationId: string;
  organizationName: string | null;
  userId: string;
  userName: string;
  context: DriverPosContextDto;
};

/**
 * Call this right after a real online `GET /api/driver/pos`
 * (getDriverPosContext) succeeds - mirrors a copy of that response into
 * SQLite for a later phase to eventually read from.
 *
 * Phase 1 rule: this is a CACHE WRITE ONLY. It never changes what the POS UI
 * renders (still the live context prop/state passed down unchanged), and it
 * can never throw - every store call already fails soft (see database.ts),
 * and the outer try/catch here is a last-resort guard on top of that, so a
 * bug in this file can still never break the online POS flow that called it.
 */
export async function hydrateDriverOfflineCache(
  input: HydrateDriverOfflineCacheInput,
): Promise<void> {
  const { context, organizationId, organizationName, userId, userName } = input;
  const driverId = context.driver.id;

  try {
    await saveDriverOfflineContext({
      organizationId,
      organizationName,
      userId,
      userName,
      driverId,
      driverName: context.driver.name,
      truckId: context.truck?.id ?? null,
      truckName: context.truck?.registration ?? context.truck?.code ?? null,
      stockLocationId: context.stockLocationId ?? null,
      tourId: context.tour?.id ?? null,
      tourCode: context.tour?.code ?? null,
      tourStatus: context.tour?.status ?? null,
    });

    await saveCachedProducts(
      { organizationId, driverId },
      context.products.map((product) => ({
        id: product.id,
        reference: product.reference,
        barcode: product.barcode ?? null,
        name: product.name,
        imageUrl: product.imageUrl ?? null,
        salePriceHT: product.salePriceHT,
        salePriceTTC: product.salePriceTTC,
        taxRate: product.taxRate,
        availableQuantity: product.availableQuantity,
        supplierId: product.supplierId ?? null,
        supplierName: product.supplierName ?? null,
      })),
    );

    await saveCachedCustomers(
      { organizationId, driverId },
      context.customers.map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        phone: customer.phone ?? null,
        status: customer.status,
      })),
    );

    // Truck stock is derived from the same product list, not a second
    // endpoint - DriverPosProductDto.availableQuantity already IS the
    // truck-scoped stock quantity (see getDriverPosContext server-side).
    if (context.truck?.id) {
      await saveCachedTruckStock(
        { organizationId, driverId, truckId: context.truck.id },
        context.products.map((product) => ({
          productId: product.id,
          quantity: product.availableQuantity,
          reservedQuantity: 0,
          availableQuantity: product.availableQuantity,
        })),
      );
    }
  } catch (error) {
    console.warn("[offline/driver-pos] hydrateDriverOfflineCache failed.", error);
  }
}
