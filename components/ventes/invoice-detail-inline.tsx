"use client";

import { InvoiceDiscountBadge } from "@/components/ventes/invoice-discount-badge";
import { InvoiceLinesTable } from "@/components/ventes/invoice-lines-table";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto, SaleHistoryListItemDto } from "@/types/operations-dto";

type InvoiceDetailInlineProps = {
  listItem: SaleHistoryListItemDto;
  sale: SaleDto;
};

/**
 * The unfolded detail of an invoice row, shared by « Factures journalières » and « Archives des factures »
 * (both render <InvoicesTable>). Compact on purpose: a title with the status badge, the products, and ONE
 * amount - the invoice's Total TTC. The order number, date, customer, user, truck and payment mode are not
 * repeated here: they are already on the row above. Display only - nothing is recomputed.
 */
export function InvoiceDetailInline({ listItem, sale }: InvoiceDetailInlineProps) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h3 className="font-heading text-sm font-semibold text-foreground sm:text-base">
          Détail de la commande {sale.displayNumber}
        </h3>
        <InvoiceStatusBadge status={listItem.status} />
        {listItem.hasDiscount ? <InvoiceDiscountBadge amountTTC={listItem.discountTTC} /> : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <InvoiceLinesTable lines={sale.lines} />
        <div className="flex items-baseline justify-end gap-4 border-t border-border bg-muted/30 px-3 py-2.5">
          <span className="text-sm font-medium text-muted-foreground">Total TTC</span>
          <span className="text-xl font-bold text-emerald-700 tabular-nums" data-testid="invoice-detail-total">
            {formatCurrency(sale.totalTTC)}
          </span>
        </div>
      </div>
    </div>
  );
}
