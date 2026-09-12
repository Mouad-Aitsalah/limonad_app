"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OfflineSaleWithLines } from "@/lib/offline/driver-pos";
import { formatCurrency } from "@/lib/utils";

export type OfflineSaleRowData = {
  sale: OfflineSaleWithLines;
  /** Resolved by the caller from the already-loaded (online or cached)
   *  context.customers - never a server fetch (see this task's own "2.
   *  SOURCE SQLITE" / "aucun fetch serveur obligatoire"). */
  customerName: string;
};

type OfflineSalesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sales: OfflineSaleRowData[];
};

function formatSoldAtTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * "CORRECTION UX OFFLINE - CONSULTER LES VENTES LOCALES SANS QUITTER LE
 * POS": lets the driver check today's still-local PENDING_SYNC sales
 * without ever leaving the already-loaded POS screen. Deliberately NOT a
 * navigation to /driver/ventes - that page is a remote Server Component,
 * unreachable while offline as long as capacitor.config.ts's server.url
 * still points at Vercel (see this task's own "8. PAS DE ROUTE OFFLINE" -
 * fixing that shell is explicitly out of scope here). Every field shown
 * here comes from the `sales` prop the caller already read via
 * getOfflineSales() (SQLite only, see sales-store.ts) - this component
 * itself never touches SQLite or the network.
 */
export function OfflineSalesDialog({ open, onOpenChange, sales }: OfflineSalesDialogProps) {
  const [expandedLocalId, setExpandedLocalId] = React.useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WifiOff aria-hidden="true" className="h-5 w-5 text-amber-600" />
            Ventes hors connexion
          </DialogTitle>
        </DialogHeader>

        {sales.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aucune vente hors connexion en attente.
          </p>
        ) : (
          <div className="-mx-1 max-h-[60vh] space-y-2 overflow-y-auto px-1">
            {sales.map(({ sale, customerName }) => {
              const expanded = expandedLocalId === sale.localId;
              return (
                <div
                  key={sale.localId}
                  className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/40 p-3"
                >
                  {/* A real <button>, not a <div role="button"> - unlike the
                      /driver/ventes rows, nothing is nested inside it here,
                      so there's no risk of an invalid nested interactive
                      control. Toggles the line-level detail (see "5. DÉTAIL
                      VENTE") - never a network/SQLite call by itself. */}
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 text-left"
                    onClick={() => setExpandedLocalId(expanded ? null : sale.localId)}
                    aria-expanded={expanded}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-foreground tabular-nums">
                        {sale.localReference}
                      </span>
                      <span className="shrink-0 font-semibold text-foreground tabular-nums">
                        {formatCurrency(sale.totalTTC)}
                      </span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{customerName}</p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {formatSoldAtTime(sale.soldAt)}
                        {" · "}
                        {/* V1 offline sales are CASH-only (see types.ts's
                            OfflinePaymentMethod) - no label lookup needed. */}
                        Espèces
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-100 px-1.5 py-0 text-[10px] font-normal text-amber-800"
                        >
                          En attente
                        </Badge>
                        {expanded ? (
                          <ChevronUp aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </button>

                  {expanded ? (
                    <div className="mt-2 space-y-1 border-t border-amber-200/80 pt-2">
                      {sale.lines.map((line) => (
                        <div
                          key={line.id}
                          className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {line.productNameSnapshot} × {line.quantity}
                          </span>
                          <span className="shrink-0 tabular-nums">{formatCurrency(line.totalTTC)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
