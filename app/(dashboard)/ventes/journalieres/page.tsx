import type { Metadata } from "next";

import { DailyInvoicesView } from "@/components/ventes/daily-invoices-view";
import { getDailyInvoicesPage } from "@/lib/server/daily-invoices";

export const metadata: Metadata = {
  title: "Factures journalières",
};

export default async function DailyInvoicesPage() {
  const initialData = await getDailyInvoicesPage();

  return (
    <div className="space-y-6">
      <DailyInvoicesView initialData={initialData} />
    </div>
  );
}
