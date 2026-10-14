import type { Metadata } from "next";

import { DailySalesGroupingView } from "@/components/ventes/daily-sales-grouping-view";
import { getCurrentBusinessDayParam } from "@/lib/business-day";
import { dailyFiltersFromQuery, toURLSearchParams } from "@/lib/daily-invoices-filters";
import { dailyParamsFromSearchParams, getDailySalesGrouping } from "@/lib/server/daily-invoices";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Regroupement des ventes",
};

/**
 * « Regroupement des ventes » of « Factures journalières »: same module, same
 * roles (getDailySalesGrouping refuses a driver; the dashboard layout's
 * RouteGuard sends one back to /driver) and the same filters, read from the URL.
 * The margin and the costs are only in the data for the admin.
 */
export default async function DailySalesGroupingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("dailyInvoices");
  const query = toURLSearchParams(await searchParams);
  const params = dailyParamsFromSearchParams(query);
  const initialData = await getDailySalesGrouping({ day: params.day, userIds: params.userIds, paymentMethod: params.paymentMethod });

  return (
    <DailySalesGroupingView
      initialData={initialData}
      initialFilters={dailyFiltersFromQuery(query, initialData.day)}
      currentDay={getCurrentBusinessDayParam()}
    />
  );
}
