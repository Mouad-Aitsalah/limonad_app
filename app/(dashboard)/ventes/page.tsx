import type { Metadata } from "next";

import { SalesView } from "@/components/ventes/sales-view";
import {
  getSalesMonthsSummary,
  getSalesOrdersPage,
  getSalesSessionsSummary,
} from "@/lib/server/sales-history";

export const metadata: Metadata = {
  title: "Ventes",
};

export default async function VentesPage() {
  const [ordersPage, sessions, months] = await Promise.all([
    getSalesOrdersPage(),
    getSalesSessionsSummary(),
    getSalesMonthsSummary(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Historique des ventes
        </h1>
        <p className="text-sm text-muted-foreground">
          Consulter les commandes et les sessions journalières du point de vente.
        </p>
      </div>

      <SalesView initialOrdersPage={ordersPage} sessions={sessions} months={months} />
    </div>
  );
}
