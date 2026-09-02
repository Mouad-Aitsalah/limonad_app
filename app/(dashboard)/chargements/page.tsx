import type { Metadata } from "next";

import { LoadingsView } from "@/components/loadings/loadings-view";
import { getDrivers } from "@/lib/server/drivers";
import { getProductPickerPreload } from "@/lib/server/products";
import { getLoadingHistoryPage } from "@/lib/server/truck-loadings";
import { getTrucks } from "@/lib/server/trucks";

export const metadata: Metadata = {
  title: "Chargements",
};

export default async function ChargementsPage() {
  // Phase 3 CRITICAL #1 fix: small bounded preload instead of getProducts()
  // (measured 12.5s/56MB at 100k products) - already ACTIVE-only, so the
  // .filter() this used to need is gone. See LoadingsView's product search.
  const [trucks, drivers, products, historyPage] = await Promise.all([
    getTrucks(),
    getDrivers(),
    getProductPickerPreload(),
    getLoadingHistoryPage(),
  ]);

  return (
    <LoadingsView
      trucks={trucks}
      drivers={drivers}
      products={products}
      initialHistoryPage={historyPage}
    />
  );
}
