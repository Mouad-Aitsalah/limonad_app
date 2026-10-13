import type { Metadata } from "next";

import { CustomerBalancesView } from "@/components/accounting/customer-balances-view";
import { getCustomerBalancesPage } from "@/lib/server/customer-balances";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Solde clients",
};

export default async function CustomerBalancesPage() {
  await requireModulePage("accounting");
  const initialPage = await getCustomerBalancesPage();

  return (
    <div className="space-y-6">
      <CustomerBalancesView initialPage={initialPage} />
    </div>
  );
}
