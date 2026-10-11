import type { Metadata } from "next";

import { SalesView } from "@/components/ventes/sales-view";
import {
  getSalesMonthsSummary,
  getSalesOrdersPage,
  getSalesSessionsSummary,
} from "@/lib/server/sales-history";

export const metadata: Metadata = {
  title: "Archives des factures",
};

export default async function VentesPage() {
  const [ordersPage, sessions, months] = await Promise.all([
    getSalesOrdersPage(),
    getSalesSessionsSummary(),
    getSalesMonthsSummary(),
  ]);

  return (
    <div className="space-y-6">
      <SalesView initialOrdersPage={ordersPage} sessions={sessions} months={months} />
    </div>
  );
}
