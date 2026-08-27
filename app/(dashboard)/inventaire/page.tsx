import type { Metadata } from "next";

import { InventoryView } from "@/components/inventory/inventory-view";
import { getDepots } from "@/lib/server/depots";
import { getInventoryHistory } from "@/lib/server/inventories";
import { getProducts } from "@/lib/server/products";

export const metadata: Metadata = {
  title: "Inventaire",
};

export default async function InventairePage() {
  const [inventories, depots, products] = await Promise.all([
    getInventoryHistory(),
    getDepots(),
    getProducts(),
  ]);

  return (
    <InventoryView
      initialInventories={inventories}
      depots={depots}
      products={products.filter((product) => product.status === "ACTIVE")}
    />
  );
}
