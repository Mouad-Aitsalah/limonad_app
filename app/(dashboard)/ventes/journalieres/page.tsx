import type { Metadata } from "next";

import { DailyInvoicesView } from "@/components/ventes/daily-invoices-view";
import { getDailyInvoicesPage } from "@/lib/server/daily-invoices";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Factures journalières",
};

export default async function DailyInvoicesPage() {
  await requireModulePage("dailyInvoices");
  const initialData = await getDailyInvoicesPage();

  return (
    <div className="space-y-6">
      <DailyInvoicesView initialData={initialData} />
    </div>
  );
}
