import type { Metadata } from "next";

import { DriverClientsView } from "@/components/driver-clients/driver-clients-view";
import { getDriverCustomersPage } from "@/lib/server/driver-customers";

export const metadata: Metadata = {
  title: "Mes clients",
};

export default async function DriverClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const params = await searchParams;
  const initialSelectedCustomerId = params.customerId?.trim() || null;
  // CRITICAL #2 follow-up: bounded first page instead of every accessible
  // customer - see getDriverCustomersPage's doc comment. guaranteeCustomerId
  // keeps a ?customerId= deep link (e.g. from the "client proche" banner)
  // resolvable even when it isn't on page 1.
  const initialPage = await getDriverCustomersPage({
    guaranteeCustomerId: initialSelectedCustomerId ?? undefined,
  });

  return (
    <DriverClientsView
      key={initialSelectedCustomerId ?? "driver-clients"}
      initialPage={initialPage}
      initialSelectedCustomerId={initialSelectedCustomerId}
    />
  );
}
