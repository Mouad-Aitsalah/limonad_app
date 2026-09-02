"use client";

import * as React from "react";

import { MonthsTable } from "@/components/ventes/months-table";
import { SalesPagination } from "@/components/ventes/sales-pagination";
import { InvoicesDrilldownDialog } from "@/components/ventes/invoices-drilldown-dialog";
import type { SalesMonthDto } from "@/types/operations-dto";

const PAGE_SIZE = 12;

function monthDateRange(month: SalesMonthDto): { dateFrom: string; dateTo: string } {
  const firstDay = new Date(month.year, month.monthNumber - 1, 1);
  const lastDay = new Date(month.year, month.monthNumber, 0);
  const toDateInput = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { dateFrom: toDateInput(firstDay), dateTo: toDateInput(lastDay) };
}

type MonthsTabProps = {
  months: SalesMonthDto[];
};

export function MonthsTab({ months }: MonthsTabProps) {
  const [page, setPage] = React.useState(1);
  const [viewingMonth, setViewingMonth] = React.useState<SalesMonthDto | null>(null);

  const totalPages = Math.max(1, Math.ceil(months.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = months.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <MonthsTable months={paginated} onSelectMonth={setViewingMonth} />

      <SalesPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />

      <InvoicesDrilldownDialog
        open={viewingMonth !== null}
        onOpenChange={(open) => {
          if (!open) setViewingMonth(null);
        }}
        title={viewingMonth ? viewingMonth.label : ""}
        description="Commandes émises durant ce mois."
        filters={viewingMonth ? monthDateRange(viewingMonth) : {}}
      />
    </div>
  );
}
