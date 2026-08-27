import type { Metadata } from "next";

import { StockView } from "@/components/stock/stock-view";
import { getProducts } from "@/lib/server/products";
import { getStockLocations } from "@/lib/server/stock-locations";
import { getStockLevels, getStockSummary } from "@/lib/server/stock-levels";
import { getStockMovements } from "@/lib/server/stock-movements";

export const metadata: Metadata = {
  title: "Stock",
};

export default async function StockPage() {
  const [levels, locations, movements, summary, products] = await Promise.all([
    getStockLevels(),
    getStockLocations(),
    getStockMovements(),
    getStockSummary(),
    getProducts(),
  ]);

  return (
    <StockView
      initialLevels={levels}
      locations={locations}
      movements={movements}
      summary={summary}
      products={products}
    />
  );
}
