"use client";

import { Clock } from "lucide-react";

import { formatCustomerCode } from "@/lib/customer-code";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

type PendingSalesPanelProps = {
  sales: SaleDto[];
  onSelect: (sale: SaleDto) => void;
  title?: string;
};

function hhmm(iso: string) {
  return new Intl.DateTimeFormat("fr-MA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * "Factures du jour" - the not-yet-collected sales of the day (server
 * status DRAFT). Persisted server-side, so this list survives a refresh, a
 * browser restart or a screen change. Clicking a row opens the collect
 * dialog. Empty -> renders nothing.
 */
export function PendingSalesPanel({
  sales,
  onSelect,
  title = "Factures du jour",
}: PendingSalesPanelProps) {
  if (sales.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-900">
        <Clock aria-hidden="true" className="h-3.5 w-3.5" />
        {title} · {sales.length} en attente
      </div>
      <ul className="space-y-1">
        {sales.map((sale) => (
          <li key={sale.id}>
            <button
              type="button"
              onClick={() => onSelect(sale)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-100 bg-white px-3 py-2 text-left text-sm transition hover:border-amber-300"
            >
              <span className="text-muted-foreground tabular-nums">{hhmm(sale.createdAt)}</span>
              <span className="min-w-0 flex-1 truncate">
                {sale.customer ? formatCustomerCode(sale.customer.code) : "Comptoir"}
                {sale.customer ? ` · ${sale.customer.name}` : ""}
              </span>
              <span className="font-semibold tabular-nums">
                {formatCurrency(sale.totalTTC)}
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                EN ATTENTE
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
