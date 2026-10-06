"use client";

import { InvoiceLinesTable } from "@/components/ventes/invoice-lines-table";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import { paymentMethodLabels } from "@/components/ventes/orders-toolbar";
import { formatSignedCurrency } from "@/lib/currency";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto, SaleHistoryListItemDto } from "@/types/operations-dto";

type InvoiceDetailInlineProps = {
  listItem: SaleHistoryListItemDto;
  sale: SaleDto;
};

export function InvoiceDetailInline({ listItem, sale }: InvoiceDetailInlineProps) {
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-muted/20 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-base font-semibold text-foreground">
          Détail de la commande {sale.displayNumber}
        </h3>
        <InvoiceStatusBadge status={listItem.status} />
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-3">
        <Info label="N° commande" value={sale.displayNumber} />
        <Info
          label="Date"
          value={new Date(sale.createdAt).toLocaleString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
        <Info label="Client" value={sale.customer?.name ?? "Client comptoir"} />
        <Info label="Chauffeur / utilisateur" value={sale.driver?.name ?? sale.createdByUserName} />
        <Info label="Camion" value={sale.truck?.code ?? "-"} />
        <Info
          label="Mode règlement"
          value={paymentMethodLabels[sale.paymentMethod] ?? sale.paymentMethod}
        />
        {sale.paymentMethod === "BANK_TRANSFER" && sale.bankAccountingAccountCode ? (
          <Info
            label="Compte bancaire"
            value={`${sale.bankAccountingAccountCode} — ${sale.bankAccountingAccountName}`}
          />
        ) : null}
      </div>

      {/* Compact on a wide screen: the products are not spread over the whole row. */}
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-background">
        <InvoiceLinesTable lines={sale.lines} />
      </div>

      <div className="mx-auto w-full max-w-xs space-y-2 rounded-xl border border-border bg-background p-3">
        <TotalRow label="Total HT" value={formatCurrency(sale.subtotalHT)} />
        <TotalRow label="TVA" value={formatCurrency(sale.taxAmount)} />
        {(sale.roundingAmount ?? 0) !== 0 ? (
          <TotalRow label="Arrondi" value={formatSignedCurrency(sale.roundingAmount ?? 0)} />
        ) : null}
        <TotalRow label="Total TTC" value={formatCurrency(sale.totalTTC)} strong />
        {listItem.net !== undefined && listItem.net !== sale.totalTTC ? (
          <TotalRow label="Net (après avoirs)" value={formatCurrency(listItem.net)} />
        ) : null}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${strong ? "text-base font-semibold" : "text-sm"}`}>
      <span className={strong ? "text-foreground" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-emerald-700" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
