import type { Metadata } from "next";

import { CustomerSettlementsView } from "@/components/accounting/customer-settlements-view";
import { getCustomerById } from "@/lib/server/customers";
import type { CustomerDto } from "@/types/operations-dto";

export const metadata: Metadata = {
  title: "Règlements clients",
};

type CustomerSettlementsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerSettlementsPage({
  searchParams,
}: CustomerSettlementsPageProps) {
  const params = await searchParams;
  const customerId = typeof params.customerId === "string" ? params.customerId : null;

  // getCustomerById scopes the lookup to the current session's own
  // organizationId (see getCustomerRecordById) - a customerId belonging to
  // another organisation, or a stale/invalid one, simply resolves to no
  // pre-selection below, never another organisation's data.
  let initialCustomer: CustomerDto | null = null;
  if (customerId) {
    try {
      initialCustomer = await getCustomerById(customerId);
    } catch {
      initialCustomer = null;
    }
  }

  return (
    <div className="space-y-6">
      <CustomerSettlementsView initialCustomer={initialCustomer} />
    </div>
  );
}
