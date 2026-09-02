import type { Metadata } from "next";

import { StockView } from "@/components/stock/stock-view";
import { getProductPickerPreload } from "@/lib/server/products";
import { getStockLocations } from "@/lib/server/stock-locations";
import { getStockLevels, getStockSummary } from "@/lib/server/stock-levels";
import { getStockMovementsPage } from "@/lib/server/stock-movements";

export const metadata: Metadata = {
  title: "Stock",
};

export default async function StockPage() {
  // Phase 3 CRITICAL #1 fix: small bounded preload instead of getProducts()
  // (measured 12.5s/56MB at 100k products) - getStockLevels()/
  // getStockSummary() are a separate, already-audited finding, untouched
  // here. See StockAdjustmentDialog/TruckStockPanel's product search.
  const [levels, locations, movementsPage, summary, products] = await Promise.all([
    getStockLevels(),
    getStockLocations(),
    getStockMovementsPage(),
    getStockSummary(),
    getProductPickerPreload(),
  ]);

  return (
    <StockView
      initialLevels={levels}
      locations={locations}
      initialMovementsPage={movementsPage}
      summary={summary}
      products={products}
    />
  );
}
