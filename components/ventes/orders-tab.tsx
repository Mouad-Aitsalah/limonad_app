"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  OrdersToolbar,
  defaultOrdersFilters,
  type OrdersFilters,
} from "@/components/ventes/orders-toolbar";
import { InvoicesTable } from "@/components/ventes/invoices-table";
import { useSalesOrdersPage } from "@/components/ventes/use-sales-orders-page";
import type { SaleHistoryOrdersPageDto } from "@/types/operations-dto";

// Section 6: search becomes server-side, debounced so each keystroke
// doesn't fire its own request - only the value actually sent to the
// server is delayed, the input itself stays instantly responsive.
const SEARCH_DEBOUNCE_MS = 400;

type OrdersTabProps = {
  initialPage: SaleHistoryOrdersPageDto;
};

export function OrdersTab({ initialPage }: OrdersTabProps) {
  const [filters, setFilters] = React.useState<OrdersFilters>(defaultOrdersFilters);
  const [debouncedSearch, setDebouncedSearch] = React.useState(filters.search);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.search]);

  function handleFilterChange<K extends keyof OrdersFilters>(key: K, value: OrdersFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const {
    items,
    totalCount,
    pageIndex,
    hasMore,
    hasPrevious,
    loading,
    goToNextPage,
    goToPreviousPage,
  } = useSalesOrdersPage(
    {
      search: debouncedSearch,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      paymentMethod: filters.paymentMethod,
    },
    initialPage,
  );

  return (
    <div className="space-y-5">
      <OrdersToolbar filters={filters} onChange={handleFilterChange} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Page {pageIndex + 1} &middot; {items.length} commande{items.length > 1 ? "s" : ""}{" "}
          affichee{items.length > 1 ? "s" : ""} sur {totalCount} au total.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasPrevious || loading}
            onClick={goToPreviousPage}
          >
            Precedent
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

      <InvoicesTable invoices={items} />
    </div>
  );
}
