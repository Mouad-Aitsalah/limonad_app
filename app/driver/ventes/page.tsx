import type { Metadata } from "next";

import { DriverSalesView } from "@/components/driver-pos/driver-sales-view";
import { getSalesForCurrentDriver, groupSalesByTour } from "@/lib/server/driver-sales";

export const metadata: Metadata = {
  title: "Mes ventes",
};

export default async function DriverSalesPage() {
  const sales = await getSalesForCurrentDriver();
  return <DriverSalesView groups={groupSalesByTour(sales)} />;
}
