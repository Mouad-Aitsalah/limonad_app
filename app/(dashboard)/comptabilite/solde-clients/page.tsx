import type { Metadata } from "next";

import { CustomerBalancesView } from "@/components/accounting/customer-balances-view";
import { getCustomerBalancesPage } from "@/lib/server/customer-balances";

export const metadata: Metadata = {
  title: "Solde clients",
};

export default async function CustomerBalancesPage() {
  const initialPage = await getCustomerBalancesPage();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Solde clients</h1>
        <p className="text-sm text-muted-foreground">
          Le solde réel de chaque client, sur le compte auxiliaire utilisé par le Journal et
          les Règlements clients.
        </p>
      </div>

      <CustomerBalancesView initialPage={initialPage} />
    </div>
  );
}
