"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Package, Percent, Search, TrendingUp } from "lucide-react";

import { DailyInvoicesFilterFields } from "@/components/ventes/daily-invoices-filter-fields";
import { MarginKpi, PrimaryKpi } from "@/components/ventes/daily-kpi-cards";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMarkupRate, marginPartialNote } from "@/lib/daily-invoice-kpis";
import {
  DAILY_SALES_GROUPING_PATH,
  dailyFiltersToQuery,
  dailyInvoicesHref,
  type DailyInvoicesFilters,
} from "@/lib/daily-invoices-filters";
import { cn, formatCurrency } from "@/lib/utils";
import type { DailyMarginDto, DailySalesGroupingDto, DailySalesProductDto } from "@/types/daily-invoice";

type DailySalesGroupingViewProps = {
  initialData: DailySalesGroupingDto;
  initialFilters: DailyInvoicesFilters;
  /** The current business day - the latest selectable one. */
  currentDay: string;
};

/**
 * Page « Regroupement des ventes » (/ventes/journalieres/regroupement). The data
 * comes from the server (lib/server/daily-invoices.ts getDailySalesGrouping):
 * this view never computes a figure, it only presents the DTO. The filters are
 * the ones of « Factures journalières » (same component, same URL query); they
 * apply on « Appliquer ».
 */
export function DailySalesGroupingView({ initialData, initialFilters, currentDay }: DailySalesGroupingViewProps) {
  const [draft, setDraft] = React.useState<DailyInvoicesFilters>(initialFilters);
  const [applied, setApplied] = React.useState<DailyInvoicesFilters>(initialFilters);
  const [data, setData] = React.useState<DailySalesGroupingDto>(initialData);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestRef = React.useRef(0);

  async function apply() {
    const request = ++requestRef.current;
    const query = dailyFiltersToQuery(draft);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/daily-invoices/sales-grouping?${query}`);
      const body = (await response.json()) as DailySalesGroupingDto & { message?: string };
      if (request !== requestRef.current) return;
      if (!response.ok) {
        setError(body.message ?? "Impossible de charger le regroupement des ventes.");
        return;
      }
      setData(body);
      // the day really used by the server (an empty or invalid day falls back to today)
      const next = { ...draft, day: body.day };
      setApplied(next);
      setDraft(next);
      // the URL carries the filters: a reload and the « Retour » keep them
      window.history.replaceState(window.history.state, "", `${DAILY_SALES_GROUPING_PATH}?${dailyFiltersToQuery(next)}`);
    } catch {
      if (request === requestRef.current) setError("Impossible de charger le regroupement des ventes.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <SalesGroupingHeader backHref={dailyInvoicesHref(applied)} />

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent>
          <DailyInvoicesFilterFields
            value={draft}
            onChange={setDraft}
            userOptions={data.userOptions}
            maxDay={currentDay}
            actions={
              <Button type="button" className="w-full max-lg:h-10 lg:w-auto" disabled={loading} onClick={() => void apply()}>
                {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                Appliquer
              </Button>
            }
          />
        </CardContent>
      </Card>

      <SalesGroupingReport data={data} error={error} />
    </div>
  );
}

/** Breadcrumb, title, subtitle and the « Retour » button (top right). */
export function SalesGroupingHeader({ backHref }: { backHref: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <nav aria-label="Fil d'Ariane" className="text-xs text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/ventes" className="hover:text-foreground hover:underline">Ventes</Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href={backHref} className="hover:text-foreground hover:underline">Factures journalières</Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="font-medium text-foreground">Regroupement des ventes</li>
          </ol>
        </nav>
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Regroupement des ventes</h2>
        <p className="text-sm text-muted-foreground">Détail des quantités, prix appliqués et marges par produit</p>
      </div>
      <Link href={backHref} data-back-link className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 self-start")}>
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Retour aux factures journalières
      </Link>
    </div>
  );
}

const amount = (value: number) => formatCurrency(value);
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The report: summary cards, « Détail par produit et prix de vente », totals.
 * The margin cards and columns only exist when the server sent a margin (admin).
 */
export function SalesGroupingReport({ data, error = null }: { data: DailySalesGroupingDto; error?: string | null }) {
  const [search, setSearch] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const { totals } = data;
  const showMargin = Boolean(data.margin);
  const products = search.trim()
    ? data.products.filter((product) => fold(`${product.name} ${product.reference}`).includes(fold(search.trim())))
    : data.products;

  const toggle = (productId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  return (
    <div className="space-y-4 lg:space-y-6">
      {error ? (
        <p role="alert" data-grouping-error className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error} Les chiffres affichés sont ceux des filtres précédents.
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Journée du {data.dayLabel} · {data.invoiceCount} facture{data.invoiceCount > 1 ? "s" : ""} · {totals.productCount} produit
        {totals.productCount > 1 ? "s" : ""}
      </p>

      {/* Four cards on a computer, two per row on a phone (two cards only without the margin right). */}
      <div data-grouping-cards className={cn("grid auto-rows-fr grid-cols-2 gap-2.5 sm:gap-3 lg:gap-4", showMargin ? "lg:grid-cols-4" : null)}>
        <PrimaryKpi
          featured
          icon={TrendingUp}
          label="CA total"
          value={amount(totals.revenueTotal)}
          iconClassName="bg-emerald-100 text-emerald-700"
          valueClassName="text-emerald-700"
        />
        <PrimaryKpi
          icon={Package}
          label="Quantité vendue"
          value={totals.totalQuantity.toLocaleString("fr-FR")}
          iconClassName="bg-sky-100 text-sky-700"
          valueClassName="text-sky-700"
        />
        {data.margin ? <MarginKpi margin={data.margin} /> : null}
        {data.margin ? (
          <PrimaryKpi
            icon={Percent}
            label="Taux de marque"
            value={formatMarkupRate(data.margin.markupRate)}
            iconClassName="bg-violet-100 text-violet-700"
            valueClassName="text-violet-700"
          />
        ) : null}
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg font-semibold text-foreground">Détail par produit et prix de vente</h3>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label="Rechercher un produit"
                  placeholder="Rechercher un produit"
                  className="pl-8 max-lg:h-10"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              {data.products.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCollapsed(collapsed.size === data.products.length ? new Set() : new Set(data.products.map((product) => product.productId)))}
                >
                  {collapsed.size === data.products.length ? "Tout développer" : "Tout réduire"}
                </Button>
              ) : null}
            </div>
          </div>

          {data.products.length === 0 ? (
            <p data-grouping-empty className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Aucune vente pour ces filtres.
            </p>
          ) : products.length === 0 ? (
            <p data-grouping-no-match className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Aucun produit ne correspond à « {search.trim()} ».
            </p>
          ) : (
            // Phones: the table keeps its columns and scrolls sideways inside the card.
            <div className="-mx-1 overflow-x-auto px-1">
              <table data-grouping-table className={cn("w-full text-sm", showMargin ? "min-w-[720px]" : "min-w-[520px]")}>
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Produit</th>
                    <th className="py-2 pr-3 text-right font-medium">Prix unitaire TTC</th>
                    <th className="py-2 pr-3 text-right font-medium">Quantité</th>
                    <th className="py-2 pr-3 text-right font-medium">Montant TTC</th>
                    {showMargin ? <th className="py-2 pr-3 text-right font-medium">Marge HT</th> : null}
                    {showMargin ? <th className="py-2 text-right font-medium">Taux de marque</th> : null}
                  </tr>
                </thead>
                {products.map((product) => (
                  <ProductRows
                    key={product.productId}
                    product={product}
                    showMargin={showMargin}
                    expanded={!collapsed.has(product.productId)}
                    onToggle={() => toggle(product.productId)}
                  />
                ))}
              </table>
            </div>
          )}

          {search.trim() && products.length > 0 && products.length < data.products.length ? (
            <p className="text-xs text-muted-foreground">
              {products.length} produit{products.length > 1 ? "s" : ""} affiché{products.length > 1 ? "s" : ""} sur {data.products.length} · les totaux ci-dessous portent sur tous les produits.
            </p>
          ) : null}

          <div data-grouping-totals className="space-y-1.5 rounded-2xl bg-muted/40 p-3 text-sm sm:p-4">
            <TotalRow label={`Total des produits (${totals.totalQuantity.toLocaleString("fr-FR")} unité${totals.totalQuantity > 1 ? "s" : ""})`} value={amount(totals.linesTotalTTC)} />
            <TotalRow label="Arrondis commerciaux" value={amount(totals.roundingTotal)} />
            <TotalRow label="CA total" value={amount(totals.revenueTotal)} strong />
            {!totals.reconciled ? (
              <p role="alert" data-grouping-gap className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Écart de {amount(Math.abs(totals.reconciliationGap))} entre le total des produits + arrondis ({amount(totals.linesTotalTTC + totals.roundingTotal)}) et le CA total des
                factures journalières ({amount(totals.revenueTotal)}).
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductRows({
  product,
  showMargin,
  expanded,
  onToggle,
}: {
  product: DailySalesProductDto;
  showMargin: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const columns = showMargin ? 6 : 4;
  return (
    // Plain white rows; a thin light-grey line closes each group. Only the product name is coloured.
    <tbody data-product={product.productId} className="border-b border-gray-200 last:border-b-0">
      <tr>
        <td colSpan={columns} className="pt-3 pb-1">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className="flex items-center gap-1.5 text-left"
          >
            <Chevron aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            {/* The ONLY coloured element of a group: same teal for every product. */}
            <span data-product-name className="font-semibold text-teal-800">{product.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{product.reference}</span>
          </button>
        </td>
      </tr>
      {expanded
        ? product.priceGroups.map((group) => (
            <tr key={group.unitPriceTTC} data-price-row className="text-foreground">
              <td className="py-1.5 pr-3 pl-6 text-xs text-muted-foreground">Prix appliqué</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{amount(group.unitPriceTTC)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{group.quantity.toLocaleString("fr-FR")}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{amount(group.amountTTC)}</td>
              {showMargin ? <MarginCells margin={group.margin} /> : null}
            </tr>
          ))
        : null}
      <tr data-product-total className="font-semibold">
        <td className="py-2 pr-3 pl-6">
          Sous-total
          {showMargin && product.margin?.partial ? (
            <span className="ml-2 text-[11px] font-normal text-amber-700" title={marginPartialNote(product.margin) ?? undefined}>
              Marge partielle
            </span>
          ) : null}
        </td>
        <td className="py-2 pr-3 text-right text-xs font-normal text-muted-foreground">
          {product.priceGroups.length} prix
        </td>
        <td className="py-2 pr-3 text-right tabular-nums">{product.totalQuantity.toLocaleString("fr-FR")}</td>
        <td className="py-2 pr-3 text-right tabular-nums">{amount(product.totalTTC)}</td>
        {showMargin ? <MarginCells margin={product.margin} /> : null}
      </tr>
    </tbody>
  );
}

function MarginCells({ margin }: { margin?: DailyMarginDto }) {
  if (!margin) {
    return (
      <>
        <td className="py-1.5 pr-3 text-right">—</td>
        <td className="py-1.5 text-right">—</td>
      </>
    );
  }
  const note = marginPartialNote(margin);
  return (
    <>
      <td className="py-1.5 pr-3 text-right tabular-nums text-amber-700" title={note ?? undefined}>
        {margin.markupRate === null && margin.partial ? "—" : amount(margin.marginHT)}
        {note && margin.markupRate !== null ? <span aria-label="Marge partielle" className="ml-1 text-amber-600">*</span> : null}
      </td>
      <td className="py-1.5 text-right tabular-nums text-amber-800">{formatMarkupRate(margin.markupRate)}</td>
    </>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong ? "font-semibold text-foreground" : "text-muted-foreground")}>
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
