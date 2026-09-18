import type { DriverStockViewStock } from "@/components/driver-stock/driver-stock-view";
import { getCachedProducts, getCachedTruckStock } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";
import type { StockLevelDto } from "@/types/operations-dto";

import { mobileFetch } from "./mobile-fetch";

/**
 * ÉTAPE 23 - "3. API" / "4. CACHE OFFLINE EXISTANT" / "5. STOCK RÉEL DU
 * CAMION": tries the same historical data (GET /api/driver/stock, a thin
 * Bearer/CORS wrapper over getCurrentDriverTruckStock() - see that route's
 * own doc comment) over Bearer, falls back to the EXISTING cached_truck_stock
 * / cached_products tables on any non-ok outcome.
 *
 * Deliberately READ-ONLY, on both branches: this never calls
 * saveCachedTruckStock/saveCachedProducts. The single writer of those two
 * tables remains hydrateDriverOfflineCache (via boot/login/POS mount/POS
 * online refresh - all unchanged) - exactly the "same stock" requirement
 * from the Étape 23 brief (POS and Stock must read the one shared table, not
 * two independently-maintained copies). Writing here too would reintroduce
 * the same "two different truths" risk the skipCustomersCache fix (Étape 22)
 * was built to prevent for customers.
 */
export async function loadShellDriverStock(params: {
  token: string | null;
  offlineContext: DriverOfflineContext;
}): Promise<{ ok: true; source: "server" | "cache"; stock: DriverStockViewStock } | { ok: false; message: string }> {
  const { token, offlineContext } = params;

  if (token) {
    const outcome = await mobileFetch<{ stock: DriverStockViewStock }>("/api/driver/stock", token);
    if (outcome.kind === "ok" && outcome.data?.stock) {
      return { ok: true, source: "server", stock: outcome.data.stock };
    }
    // unauthorized/network_error/server_error - fall through to the cache,
    // same graceful degrade as driver-clients-data-source.ts's own fetcher.
  }

  return loadOfflineStock(offlineContext);
}

/**
 * ÉTAPE 23 - "2. DONNÉES UTILISÉES": DriverStockView only ever reads
 * {productName, productReference, quantity, availableQuantity, stockValue,
 * updatedAt} off each level (see that component's own JSX) - every other
 * StockLevelDto field is filled with a neutral placeholder here (never
 * rendered), same documented-placeholder pattern as
 * driver-clients-data-source.ts's offline customer rows. `stockValue` is
 * recomputed as salePriceHT * quantity - the exact same formula
 * lib/server/stock-levels.ts's mapStockLevelToDto uses server-side, so the
 * offline number matches what was last seen online.
 *
 * Missing offline (documented gap, not invented): cached_truck_stock has no
 * separate truck code/registration/brand/model, only offline_context's single
 * flattened `truckName` string (registration, falling back to code, set once
 * at hydration time - see bootstrap.ts). Both the header's "code" and
 * "Immatriculation" fields fall back to that same string; brand/model stay
 * null. The real distinct values are never fabricated.
 */
async function loadOfflineStock(
  offlineContext: DriverOfflineContext,
): Promise<{ ok: true; source: "cache"; stock: DriverStockViewStock } | { ok: false; message: string }> {
  if (!offlineContext.truckId) {
    return { ok: false, message: "Aucun camion n'est affecte a votre compte." };
  }

  const scope = { organizationId: offlineContext.organizationId, driverId: offlineContext.driverId };
  const [stockRows, products] = await Promise.all([
    getCachedTruckStock(scope),
    getCachedProducts(scope),
  ]);

  if (stockRows.length === 0) {
    return {
      ok: false,
      message: "Aucune donnee de stock disponible hors connexion pour le moment.",
    };
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const levels: StockLevelDto[] = [];
  for (const row of stockRows) {
    const product = productById.get(row.productId);
    if (!product) continue;
    levels.push({
      id: row.productId,
      productId: row.productId,
      productReference: product.reference,
      productName: product.name,
      barcode: product.barcode,
      categoryId: "",
      categoryName: "",
      brandId: null,
      brandName: null,
      supplierId: product.supplierId,
      supplierName: product.supplierName,
      locationId: offlineContext.stockLocationId ?? "",
      locationCode: "",
      locationName: offlineContext.truckName ?? "Camion",
      locationType: "TRUCK",
      quantity: row.quantity,
      reservedQuantity: row.reservedQuantity,
      availableQuantity: row.availableQuantity,
      minimumStock: 0,
      salePrice: product.salePriceHT,
      stockValue: product.salePriceHT * row.quantity,
      status: row.availableQuantity <= 0 ? "OUT_OF_STOCK" : "AVAILABLE",
      updatedAt: row.lastSyncedAt,
    });
  }

  return {
    ok: true,
    source: "cache",
    stock: {
      truck: {
        id: offlineContext.truckId,
        code: offlineContext.truckName ?? "",
        registration: offlineContext.truckName ?? "",
        brand: null,
        model: null,
        status: "",
      },
      location: {
        id: offlineContext.stockLocationId ?? "",
        code: "",
        name: offlineContext.truckName ? `Camion ${offlineContext.truckName}` : "Stock camion",
        type: "TRUCK",
      },
      levels,
    },
  };
}
