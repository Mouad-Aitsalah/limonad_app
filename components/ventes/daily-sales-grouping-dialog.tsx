"use client";

import * as React from "react";
import { Layers, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMarkupRate, marginPartialNote } from "@/lib/daily-invoice-kpis";
import { formatCurrency } from "@/lib/utils";
import type { DailyMarginDto, DailySalesGroupingDto } from "@/types/daily-invoice";
import type { DailyInvoicesFilters } from "@/components/ventes/use-daily-invoices-page";

/** Query string of the grouping - exactly the filters of the page (day, users, payment method). */
export function salesGroupingQuery({ day, userIds, paymentMethod }: DailyInvoicesFilters): string {
  const query = new URLSearchParams({ day });
  if (userIds.length) query.set("userIds", userIds.join(","));
  if (paymentMethod && paymentMethod !== "all") query.set("paymentMethod", paymentMethod);
  return query.toString();
}

/**
 * « Regroupement des ventes »: button + dialog. Loads, on opening, the grouping of
 * the invoices matching the ACTIVE filters (GET /api/daily-invoices/sales-grouping).
 */
export function DailySalesGroupingButton({ filters }: { filters: DailyInvoicesFilters }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<DailySalesGroupingDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const requestRef = React.useRef(0);

  // Loaded on each opening, with the filters active at that moment (the dialog is
  // modal: the filters cannot change while it is open). A late answer of an older
  // request is ignored.
  async function openGrouping() {
    const request = ++requestRef.current;
    setOpen(true);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const response = await fetch(`/api/daily-invoices/sales-grouping?${salesGroupingQuery(filters)}`);
      const body = (await response.json()) as DailySalesGroupingDto & { message?: string };
      if (request !== requestRef.current) return;
      if (!response.ok) {
        setError(body.message ?? "Impossible de charger le regroupement des ventes.");
        return;
      }
      setData(body);
    } catch {
      if (request === requestRef.current) setError("Impossible de charger le regroupement des ventes.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => void openGrouping()}>
        <Layers aria-hidden="true" className="h-4 w-4" />
        Regroupement des ventes
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Regroupement des ventes</DialogTitle>
            <DialogDescription>
              Ventes des filtres actifs, par produit et par prix unitaire TTC réellement appliqué (remise comprise).
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Chargement…
            </div>
          ) : error ? (
            <div className="flex flex-1 items-center justify-center py-16 text-sm text-destructive">{error}</div>
          ) : data ? (
            <div className="flex-1 overflow-y-auto px-1 py-1">
              <SalesGroupingContent data={data} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

const amount = (value: number) => formatCurrency(value);
const units = (value: number) => `${value.toLocaleString("fr-FR")} unité${Math.abs(value) > 1 ? "s" : ""}`;

/** The grouping itself - a pure render of the DTO (the margin blocks only exist when the server sent them). */
export function SalesGroupingContent({ data }: { data: DailySalesGroupingDto }) {
  const { totals } = data;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Journée du {data.dayLabel} · {data.invoiceCount} facture{data.invoiceCount > 1 ? "s" : ""} ·{" "}
        {totals.productCount} produit{totals.productCount > 1 ? "s" : ""}
      </p>

      {data.products.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Aucune vente pour ces filtres.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.products.map((product) => (
            <li key={product.productId} data-product={product.productId} className="rounded-2xl border border-border bg-white p-3 sm:p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-semibold text-foreground">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.reference}</p>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 font-medium">Prix unitaire TTC</th>
                    <th className="py-1 text-right font-medium">Quantité</th>
                    <th className="py-1 text-right font-medium">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {product.priceGroups.map((group) => (
                    <tr key={group.unitPriceTTC} data-price-row className="border-t border-border/60">
                      <td className="py-1.5 tabular-nums">{amount(group.unitPriceTTC)}</td>
                      <td className="py-1.5 text-right tabular-nums">{group.quantity.toLocaleString("fr-FR")}</td>
                      <td className="py-1.5 text-right tabular-nums">{amount(group.amountTTC)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr data-product-total className="border-t border-border font-semibold">
                    <td className="py-1.5">Total</td>
                    <td className="py-1.5 text-right tabular-nums">{product.totalQuantity.toLocaleString("fr-FR")}</td>
                    <td className="py-1.5 text-right tabular-nums">{amount(product.totalTTC)}</td>
                  </tr>
                </tfoot>
              </table>
              {product.margin ? <MarginLine margin={product.margin} /> : null}
            </li>
          ))}
        </ul>
      )}

      <div data-grouping-totals className="space-y-1.5 rounded-2xl bg-muted/40 p-3 text-sm sm:p-4">
        <Row label={`Total des produits (${units(totals.totalQuantity)})`} value={amount(totals.linesTotalTTC)} />
        <Row label="Arrondis commerciaux" value={amount(totals.roundingTotal)} />
        <Row label="CA total" value={amount(totals.revenueTotal)} strong />
        {!totals.reconciled ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Écart de {amount(Math.abs(totals.reconciliationGap))} entre les produits + arrondis et le CA total.
          </p>
        ) : null}
        {data.margin ? (
          <div className="border-t border-border pt-2">
            <MarginLine margin={data.margin} label="Marge totale (HT)" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function MarginLine({ margin, label = "Marge HT" }: { margin: DailyMarginDto; label?: string }) {
  const note = marginPartialNote(margin);
  return (
    <div data-margin className="mt-2 space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-baseline gap-3 tabular-nums">
          <span className="font-semibold text-amber-700">{amount(margin.marginHT)}</span>
          <span title="Taux de marque = marge HT / CA HT × 100" className="text-xs font-semibold text-amber-800">
            {formatMarkupRate(margin.markupRate)}
          </span>
        </span>
      </div>
      {note ? <p className="text-[11px] leading-snug text-amber-700">Marge partielle · {note}</p> : null}
    </div>
  );
}
