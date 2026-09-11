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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Factures journalières
        </h1>
        <p className="text-sm text-muted-foreground">
          Les factures vendues sur une journée commerciale (02:00 → 02:00), avec le chiffre
          d&apos;affaires total et par mode de règlement.
        </p>
      </div>

      <DailyInvoicesView initialData={initialData} />
    </div>
  );
}
