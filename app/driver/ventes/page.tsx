import type { Metadata } from "next";

import { DriverSalesView } from "@/components/driver-pos/driver-sales-view";
import { getTodaySalesForCurrentDriver } from "@/lib/server/driver-sales";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Mes ventes",
};

export default async function DriverSalesPage() {
  await requireModulePage("driverApp");
  const data = await getTodaySalesForCurrentDriver();
  return <DriverSalesView data={data} />;
}
