import type { Metadata } from "next";

import { SalesView } from "@/components/ventes/sales-view";
import {
  getSalesMonthsSummary,
  getSalesOrdersPage,
  getSalesSessionsSummary,
} from "@/lib/server/sales-history";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Archives des factures",
};

export default async function VentesPage() {
  await requireModulePage("salesArchive");
  const [ordersPage, sessions, months] = await Promise.all([
    getSalesOrdersPage({ includeCreditNotes: true }),
    getSalesSessionsSummary(),
    getSalesMonthsSummary(),
  ]);

  return (
    <div className="space-y-6">
      <SalesView initialOrdersPage={ordersPage} sessions={sessions} months={months} />
    </div>
  );
}
