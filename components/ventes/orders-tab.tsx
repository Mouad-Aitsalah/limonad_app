"use client";

import * as React from "react";

import {
  OrdersToolbar,
  defaultOrdersFilters,
  type OrdersFilters,
} from "@/components/ventes/orders-toolbar";
import { InvoicesTable } from "@/components/ventes/invoices-table";
import { SalesPagination } from "@/components/ventes/sales-pagination";
import type { SaleDto } from "@/types/operations-dto";

const PAGE_SIZE = 10;

type OrdersTabProps = {
  invoices: SaleDto[];
};

export function OrdersTab({ invoices }: OrdersTabProps) {
  const [filters, setFilters] = React.useState<OrdersFilters>(defaultOrdersFilters);
  const [page, setPage] = React.useState(1);

  function handleFilterChange<K extends keyof OrdersFilters>(
    key: K,
    value: OrdersFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  const filteredInvoices = React.useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const to = filters.dateTo ? new Date(filters.dateTo) : null;
    if (to) to.setHours(23, 59, 59, 999);

    return invoices
      .filter((invoice) => {
        const date = new Date(invoice.createdAt);
        const matchesSearch =
          query.length === 0 ||
          invoice.displayNumber.toLowerCase().includes(query) ||
          invoice.invoiceNumber.toLowerCase().includes(query) ||
          (invoice.customer?.name ?? "").toLowerCase().includes(query) ||
          (invoice.driver?.name ?? "").toLowerCase().includes(query) ||
          invoice.createdByUserName.toLowerCase().includes(query);

        const matchesFrom = !from || date >= from;
        const matchesTo = !to || date <= to;

        const matchesPayment =
          filters.paymentMethod === "all" || invoice.paymentMethod === filters.paymentMethod;

        return matchesSearch && matchesFrom && matchesTo && matchesPayment;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [invoices, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedInvoices = filteredInvoices.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className="space-y-5">
      <OrdersToolbar filters={filters} onChange={handleFilterChange} />

      <p className="text-sm text-muted-foreground">
        {filteredInvoices.length} commande
        {filteredInvoices.length > 1 ? "s" : ""}
      </p>

      <InvoicesTable invoices={paginatedInvoices} />

      <SalesPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
