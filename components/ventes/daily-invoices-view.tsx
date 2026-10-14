"use client";

import * as React from "react";
import Link from "next/link";
import { Layers } from "lucide-react";

import { DailyKpiCards } from "@/components/ventes/daily-kpi-cards";
import { DailyInvoicesFilterFields } from "@/components/ventes/daily-invoices-filter-fields";
import { InvoicesTable } from "@/components/ventes/invoices-table";
import { TableColumnsPanel } from "@/components/table-columns/table-columns-panel";
import { useDailyInvoicesPage } from "@/components/ventes/use-daily-invoices-page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { dailyInvoicesHref, dailySalesGroupingHref, type DailyInvoicesFilters } from "@/lib/daily-invoices-filters";
import { formatCurrency } from "@/lib/utils";
import type { DailyInvoicesPageDto } from "@/types/daily-invoice";

type DailyInvoicesViewProps = {
  initialData: DailyInvoicesPageDto;
  /** The filters of the URL (e.g. coming back from « Regroupement des ventes »). */
  initialFilters: DailyInvoicesFilters;
  /** The current business day - the latest selectable one. */
  currentDay: string;
};

export function DailyInvoicesView({ initialData, initialFilters, currentDay }: DailyInvoicesViewProps) {
  const [filters, setFilters] = React.useState<DailyInvoicesFilters>(initialFilters);
  const { day, userIds, paymentMethod } = filters;

  const {
    data,
    pageIndex,
    hasMore,
    hasPrevious,
    loading,
    goToNextPage,
    goToPreviousPage,
    refetch,
  } = useDailyInvoicesPage({ day, userIds, paymentMethod }, initialData);

  // The URL carries the active filters (a reload, the « Retour » of the grouping
  // page and a shared link all show the same invoices). No navigation: the
  // browser's own history entry is updated in place.
  const href = dailyInvoicesHref(filters);
  React.useEffect(() => {
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.replaceState(window.history.state, "", href);
    }
  }, [href]);

  const { kpis } = data;

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Filters - the same component as the « Regroupement des ventes » page. */}
      <DailyInvoicesFilterFields
        value={filters}
        onChange={setFilters}
        userOptions={data.userOptions}
        maxDay={currentDay}
      />

      {/* KPIs */}
      <DailyKpiCards kpis={kpis} />

      {!kpis.reconciled ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Écart de {formatCurrency(Math.abs(kpis.breakdownTotal - kpis.revenueTotal))} entre le
          détail par mode ({formatCurrency(kpis.breakdownTotal)}) et le CA total (
          {formatCurrency(kpis.revenueTotal)}).
        </p>
      ) : null}

      {/* Table */}
      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Journée du {data.dayLabel} · page {pageIndex + 1} · {data.items.length} sur{" "}
              {data.totalCount} facture{data.totalCount > 1 ? "s" : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* Opens the dedicated page with the same filters (day, users, payment method). */}
              <Link
                href={dailySalesGroupingHref(filters)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Layers aria-hidden="true" className="h-4 w-4" />
                Regroupement des ventes
              </Link>
              {/* admin only: renders nothing for another role */}
              <TableColumnsPanel pageKey="dailyInvoices" table="invoices" tableName="Factures" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasPrevious || loading}
                onClick={goToPreviousPage}
              >
                Précédent
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasMore || loading}
                onClick={goToNextPage}
              >
                Suivant
              </Button>
            </div>
          </div>

          <InvoicesTable invoices={data.items} onSaleChanged={refetch} dailyLayout />
        </CardContent>
      </Card>
    </div>
  );
}
