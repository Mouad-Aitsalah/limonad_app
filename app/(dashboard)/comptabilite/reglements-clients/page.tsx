import type { Metadata } from "next";

import { CustomerSettlementsView } from "@/components/accounting/customer-settlements-view";

export const metadata: Metadata = {
  title: "Règlements clients",
};

export default function CustomerSettlementsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Règlements clients
        </h1>
        <p className="text-sm text-muted-foreground">
          Consulter le compte client et enregistrer un règlement.
        </p>
      </div>

      <CustomerSettlementsView />
    </div>
  );
}
