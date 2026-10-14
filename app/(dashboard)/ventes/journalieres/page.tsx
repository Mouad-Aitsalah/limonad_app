import type { Metadata } from "next";

import { DailyInvoicesView } from "@/components/ventes/daily-invoices-view";
import { getCurrentBusinessDayParam } from "@/lib/business-day";
import { dailyFiltersFromQuery, toURLSearchParams } from "@/lib/daily-invoices-filters";
import { dailyParamsFromSearchParams, getDailyInvoicesPage } from "@/lib/server/daily-invoices";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Factures journalières",
};

export default async function DailyInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("dailyInvoices");
  // The filters of the URL (the « Retour » of « Regroupement des ventes », a reload,
  // a shared link); none = the current business day, every user, every method.
  const query = toURLSearchParams(await searchParams);
  const params = dailyParamsFromSearchParams(query);
  const initialData = await getDailyInvoicesPage({ day: params.day, userIds: params.userIds, paymentMethod: params.paymentMethod });

  return (
    <div className="space-y-6">
      <DailyInvoicesView
        initialData={initialData}
        initialFilters={dailyFiltersFromQuery(query, initialData.day)}
        currentDay={getCurrentBusinessDayParam()}
      />
    </div>
  );
}
