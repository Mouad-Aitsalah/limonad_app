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
 *
 * Temporary diagnostic logging (Phase 2 bug hunt - "products disappear
 * offline"): every save's actual return value is now checked and logged, so
 * a real device log can show precisely which table (if any) failed to
 * write, instead of the previous silent await that hid a `false` result.
 */
export async function hydrateDriverOfflineCache(
  input: HydrateDriverOfflineCacheInput,
): Promise<void> {
  const { context, organizationId, organizationName, userId, userName } = input;
  const driverId = context.driver.id;

  console.log("[OFFLINE CACHE] identity", { organizationId, driverId });

  try {
    const contextSaved = await saveDriverOfflineContext({
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
    if (!contextSaved) {
      console.error("[OFFLINE CACHE] SQLite error", "saveDriverOfflineContext returned false");
    }

    const productsSaved = await saveCachedProducts(
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
    console.log(
      "[OFFLINE CACHE] products saved",
      productsSaved ? context.products.length : 0,
      productsSaved ? "" : "(write failed - see prior SQLite error)",
    );

    const customersSaved = await saveCachedCustomers(
      { organizationId, driverId },
      context.customers.map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        phone: customer.phone ?? null,
        status: customer.status,
      })),
    );
    console.log(
      "[OFFLINE CACHE] customers saved",
      customersSaved ? context.customers.length : 0,
      customersSaved ? "" : "(write failed - see prior SQLite error)",
    );

    // Truck stock is derived from the same product list, not a second
    // endpoint - DriverPosProductDto.availableQuantity already IS the
    // truck-scoped stock quantity (see getDriverPosContext server-side).
    if (context.truck?.id) {
      const stockSaved = await saveCachedTruckStock(
        { organizationId, driverId, truckId: context.truck.id },
        context.products.map((product) => ({
          productId: product.id,
          quantity: product.availableQuantity,
          reservedQuantity: 0,
          availableQuantity: product.availableQuantity,
        })),
      );
      console.log(
        "[OFFLINE CACHE] stock saved",
        stockSaved ? context.products.length : 0,
        stockSaved ? "" : "(write failed - see prior SQLite error)",
      );
    } else {
      console.log("[OFFLINE CACHE] stock saved 0 (no truck on this context)");
    }
  } catch (error) {
    console.error("[OFFLINE CACHE] SQLite error", error);
    console.warn("[offline/driver-pos] hydrateDriverOfflineCache failed.", error);
  }
}
