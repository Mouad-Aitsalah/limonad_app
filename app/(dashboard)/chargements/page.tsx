import type { Metadata } from "next";

import { LoadingsView } from "@/components/loadings/loadings-view";
import { getDrivers } from "@/lib/server/drivers";
import { getProducts } from "@/lib/server/products";
import { getLoadingHistory } from "@/lib/server/truck-loadings";
import { getTrucks } from "@/lib/server/trucks";

export const metadata: Metadata = {
  title: "Chargements",
};

export default async function ChargementsPage() {
  const [trucks, drivers, products, history] = await Promise.all([
    getTrucks(),
    getDrivers(),
    getProducts(),
    getLoadingHistory(),
  ]);

  return (
    <LoadingsView
      trucks={trucks}
      drivers={drivers}
      products={products.filter((product) => product.status === "ACTIVE")}
      history={history}
    />
  );
}
