"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InvoicesTable } from "@/components/ventes/invoices-table";
import { useSalesOrdersPage, type OrdersQueryFilters } from "@/components/ventes/use-sales-orders-page";

type InvoicesDrilldownDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Scopes the drilldown to one session (posSessionId) or one month
   * (dateFrom/dateTo) - see SessionsTab/MonthsTab. */
  filters: OrdersQueryFilters;
};

/**
 * Phase 3: was a client-side slice of the full, already-loaded orders
 * array (see the Phase 3 report) - now fetches its own server-paginated,
 * server-filtered page via the same GET /api/sales-history the main
 * Commandes tab uses, scoped to exactly this session or month.
 */
export function InvoicesDrilldownDialog({
  open,
  onOpenChange,
  title,
  description,
  filters,
}: InvoicesDrilldownDialogProps) {
  const { items, totalCount, pageIndex, hasMore, hasPrevious, loading, goToNextPage, goToPreviousPage } =
    useSalesOrdersPage(filters, undefined, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-1 py-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Page {pageIndex + 1} &middot; {items.length} commande{items.length > 1 ? "s" : ""} sur{" "}
              {totalCount} au total.
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
      </DialogContent>
    </Dialog>
  );
}
