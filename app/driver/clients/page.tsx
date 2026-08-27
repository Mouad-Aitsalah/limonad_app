import type { Metadata } from "next";

import { DriverClientsView } from "@/components/driver-clients/driver-clients-view";
import { getCustomersForCurrentDriver } from "@/lib/server/driver-customers";

export const metadata: Metadata = {
  title: "Mes clients",
};

export default async function DriverClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const customers = await getCustomersForCurrentDriver();
  const params = await searchParams;
  const initialSelectedCustomerId = params.customerId?.trim() || null;

  return (
    <DriverClientsView
      key={initialSelectedCustomerId ?? "driver-clients"}
      initialCustomers={customers}
      initialSelectedCustomerId={initialSelectedCustomerId}
    />
  );
}
