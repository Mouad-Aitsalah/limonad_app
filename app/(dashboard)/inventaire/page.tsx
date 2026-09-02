import type { Metadata } from "next";

import { InventoryView } from "@/components/inventory/inventory-view";
import { getDepots } from "@/lib/server/depots";
import { getInventoryHistory } from "@/lib/server/inventories";
import { getProductPickerPreload } from "@/lib/server/products";

export const metadata: Metadata = {
  title: "Inventaire",
};

export default async function InventairePage() {
  // Phase 3 CRITICAL #1 fix: small bounded preload instead of getProducts()
  // (measured 12.5s/56MB at 100k products) - already ACTIVE-only. See
  // InventoryCaptureDialog's product search.
  const [inventories, depots, products] = await Promise.all([
    getInventoryHistory(),
    getDepots(),
    getProductPickerPreload(),
  ]);

  return (
    <InventoryView initialInventories={inventories} depots={depots} products={products} />
  );
}
