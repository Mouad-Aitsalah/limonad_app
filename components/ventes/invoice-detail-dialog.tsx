"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import { paymentMethodLabels } from "@/components/ventes/orders-toolbar";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto, SaleHistoryListItemDto } from "@/types/operations-dto";

type InvoiceDetailDialogProps = {
  // The list row that triggered opening the dialog - used for the `net`
  // value (a sales-history aggregation, not part of the plain sale record)
  // and to show something instantly while the full record loads.
  listItem: SaleHistoryListItemDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Phase 3: the Commandes list only ever carries the light
 * SaleHistoryListItemDto (see that type's doc comment) - opening a single
 * invoice now fetches its full record (lines, payments, every relation)
 * on demand via the existing GET /api/sales/[id] (getSaleById, already
 * org-scoped and used elsewhere - untouched by this rewrite), for exactly
 * the one sale being viewed. `net` is carried over from the list row
 * rather than recomputed here, since it is a sales-history-specific
 * aggregation getSaleById never computes.
 */
export function InvoiceDetailDialog({ listItem, open, onOpenChange }: InvoiceDetailDialogProps) {
  const [sale, setSale] = React.useState<SaleDto | null>(null);
  const [errorFor, setErrorFor] = React.useState<{ id: string; message: string } | null>(null);

  React.useEffect(() => {
    if (!open || !listItem) return;
    let cancelled = false;
    fetch(`/api/sales/${listItem.id}`)
      .then(async (response) => {
        const body = (await response.json()) as { sale?: SaleDto; message?: string };
        if (cancelled) return;
        if (!response.ok || !body.sale) {
          setErrorFor({
            id: listItem.id,
            message: body.message ?? "Impossible de charger le detail de la commande.",
          });
          return;
        }
        setSale(body.sale);
      })
      .catch(() => {
        if (!cancelled) {
          setErrorFor({ id: listItem.id, message: "Impossible de charger le detail de la commande." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, listItem]);

  // Never render a previous invoice's data under a new/closed listItem -
  // derived directly instead of resetting state from the effect above (see
  // components/cash-deposits/deposit-detail-dialog.tsx for the same
  // established pattern in this codebase).
  const displayedSale = listItem && sale?.id === listItem.id ? sale : null;
  const error = listItem && errorFor?.id === listItem.id ? errorFor.message : null;
  const loading = listItem !== null && displayedSale === null && error === null;
  const net = listItem?.net;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        {listItem && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">Commande {listItem.displayNumber}</DialogTitle>
                <InvoiceStatusBadge status={listItem.status} />
              </div>
              <DialogDescription>Detail de la commande et des articles vendus.</DialogDescription>
            </DialogHeader>

            {loading && (
              <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Chargement du detail...
              </div>
            )}

            {error && (
              <div className="flex flex-1 items-center justify-center py-16 text-sm text-destructive">
                {error}
              </div>
            )}

            {displayedSale && (() => {
              const sale = displayedSale;
              return (
              <div className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
                <div className="grid gap-4 rounded-2xl border border-border bg-muted/40 p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">N° commande</p>
                    <p className="text-sm font-medium text-foreground">{sale.displayNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-sm font-medium text-foreground">
                      {new Date(sale.createdAt).toLocaleString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Client</p>
                    <p className="text-sm font-medium text-foreground">
                      {sale.customer?.name ?? "Client comptoir"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Chauffeur / utilisateur</p>
                    <p className="text-sm font-medium text-foreground">
                      {sale.driver?.name ?? sale.createdByUserName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Camion</p>
                    <p className="text-sm font-medium text-foreground">{sale.truck?.code ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Mode reglement</p>
                    <p className="text-sm font-medium text-foreground">
                      {paymentMethodLabels[sale.paymentMethod] ?? sale.paymentMethod}
                    </p>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produit</TableHead>
                      <TableHead className="text-right">Quantite</TableHead>
                      <TableHead className="text-right">Prix</TableHead>
                      <TableHead className="text-right">Remise</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sale.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium text-foreground">
                          {line.productName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(line.unitPriceHT)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.discountRate > 0 ? `${line.discountRate}%` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(line.totalTTC)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Separator />

                <div className="ml-auto max-w-xs space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total HT</span>
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(sale.subtotalHT)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">TVA</span>
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(sale.taxAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-base font-semibold">
                    <span className="text-foreground">Total TTC</span>
                    <span className="tabular-nums text-emerald-700">
                      {formatCurrency(sale.totalTTC)}
                    </span>
                  </div>
                  {net !== undefined && net !== sale.totalTTC && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Net (apres avoirs)</span>
                      <span className="tabular-nums text-foreground">{formatCurrency(net)}</span>
                    </div>
                  )}
                </div>
              </div>
              );
            })()}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
