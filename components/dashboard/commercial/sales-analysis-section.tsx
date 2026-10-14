"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp, Truck, Users } from "lucide-react";

import {
  AnalysisKpiCard,
  AnalysisState,
  EmptyAnalysis,
  FilterField,
  InfoHint,
  OptionSelect,
} from "@/components/dashboard/commercial/analysis-ui";
import { MultiSelectFilter, selectionParam, type MultiSelectOption } from "@/components/dashboard/commercial/multi-select-filter";
import { useAnalysisData } from "@/components/dashboard/commercial/use-analysis-data";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentMonthParam, formatDayFr, recentMonths } from "@/lib/commercial-analysis/period";
import { PRODUCTS_PREVIEW_COUNT, visibleProductRows } from "@/lib/commercial-analysis/sales-analysis";
import { cn, formatCurrency } from "@/lib/utils";
import { NO_SUPPLIER, type SalesAnalysisDto, type SalesMetric, type SortDirection } from "@/types/commercial-analysis";

const METRICS: Array<{ value: SalesMetric; label: string }> = [
  { value: "quantity", label: "Quantité vendue" },
  { value: "revenue", label: "Chiffre d'affaires" },
  { value: "margin", label: "Marge" },
];

const MARGIN_HINT =
  "Marge = chiffre d'affaires HT net des remises et des retours − coût d'achat HT des quantités vendues. Le coût est celui enregistré sur chaque ligne au moment de la vente (jamais le prix d'achat actuel).";
const REVENUE_HINT =
  "Total HT des lignes de facture des ventes validées (remises déduites), moins les retours (avoirs clients validés du mois).";
const QUANTITY_HINT = "Unités vendues moins les unités retournées (avoirs clients validés du mois).";
const SELLER_HINT =
  "Vendeur d'une vente = le chauffeur de la vente, sinon l'utilisateur qui l'a enregistrée (vente au comptoir). Chaque vente n'a qu'un vendeur : plusieurs utilisateurs sélectionnés sont additionnés sans double comptage.";

const number = new Intl.NumberFormat("fr-FR");

export function SalesAnalysisSection() {
  const months = React.useMemo(() => recentMonths(24), []);
  const [userIds, setUserIds] = React.useState<string[]>([]);
  const [month, setMonth] = React.useState(currentMonthParam());
  const [supplierIds, setSupplierIds] = React.useState<string[]>([]);
  const [metric, setMetric] = React.useState<SalesMetric>("revenue");
  const [productsExpanded, setProductsExpanded] = React.useState(false);
  // the table's own sort: follows the main indicator until the user clicks a column
  const [sortOverride, setSortOverride] = React.useState<{ key: SalesMetric; direction: SortDirection } | null>(null);
  const sort = sortOverride ?? { key: metric, direction: "desc" as SortDirection };

  const params = new URLSearchParams({ month, metric, sort: sort.key, direction: sort.direction });
  const userParam = selectionParam(userIds);
  const supplierParam = selectionParam(supplierIds);
  if (userParam) params.set("userIds", userParam);
  if (supplierParam) params.set("supplierIds", supplierParam);
  const { loading, data, lastData, error, retry } = useAnalysisData<SalesAnalysisDto>(`/api/dashboard/sales-analysis?${params.toString()}`);
  const shown = data ?? lastData;

  // the options come with the data (the last answer is kept while the next one loads: no flicker)
  const userOptions = React.useMemo<MultiSelectOption[]>(
    () => (shown?.users ?? []).map((user) => ({ value: user.id, label: user.name, hint: user.isDriver ? "chauffeur" : undefined })),
    [shown?.users],
  );
  const supplierOptions = React.useMemo<MultiSelectOption[]>(
    () => [
      ...(shown?.hasProductsWithoutSupplier ? [{ value: NO_SUPPLIER, label: "Sans fournisseur", special: true }] : []),
      ...(shown?.suppliers ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name })),
    ],
    [shown?.hasProductsWithoutSupplier, shown?.suppliers],
  );

  const monthOptions = months.some((m) => m.value === month) ? months : [{ value: month, label: month }, ...months];

  function toggleSort(key: SalesMetric) {
    setSortOverride((current) => {
      const active = current ?? { key: metric, direction: "desc" as SortDirection };
      return active.key === key
        ? { key, direction: active.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" };
    });
  }

  const visible = visibleProductRows(shown?.products ?? [], productsExpanded);
  const maxMain = Math.max(0, ...(shown?.products ?? []).map((row) => Math.abs(row[metric])));
  const filtered = Boolean(userParam || supplierParam);

  return (
    <SectionCard
      title="Analyse des ventes"
      description="Ventes validées par utilisateur, par produit et par fournisseur, nettes des retours."
      contentClassName="space-y-5"
    >
      <div className="grid items-start gap-3 sm:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <FilterField label="Utilisateurs">
          <MultiSelectFilter
            label="Utilisateurs"
            icon={Users}
            options={userOptions}
            value={userIds}
            onChange={setUserIds}
            allLabel="Tous les utilisateurs"
            plural="utilisateurs"
            emptyText="Aucun utilisateur."
          />
        </FilterField>
        <FilterField label="Mois">
          <OptionSelect ariaLabel="Mois" value={month} options={monthOptions} onChange={setMonth} />
        </FilterField>
        <FilterField label="Fournisseurs">
          <MultiSelectFilter
            label="Fournisseurs"
            icon={Truck}
            options={supplierOptions}
            value={supplierIds}
            onChange={setSupplierIds}
            allLabel="Tous les fournisseurs"
            plural="fournisseurs"
            emptyText="Aucun fournisseur."
          />
        </FilterField>
        <FilterField label="Indicateur principal" className="sm:col-span-2 2xl:col-span-1">
          <div role="group" aria-label="Indicateur principal" className="inline-flex w-full rounded-xl border border-border bg-muted/30 p-1">
            {METRICS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={metric === item.value}
                onClick={() => {
                  setMetric(item.value);
                  setSortOverride(null);
                }}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors",
                  metric === item.value ? "bg-white text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </FilterField>
      </div>

      {shown ? (
        <p className="text-sm text-muted-foreground" data-period>
          <span className="font-medium capitalize text-foreground">{shown.period.label}</span> · du {formatDayFr(shown.period.fromDay)} au{" "}
          {formatDayFr(shown.period.toDay)} (journées commerciales, 02:00 → 02:00)
        </p>
      ) : null}

      <AnalysisState loading={loading} error={error} onRetry={retry} />

      {shown ? (
        <div className={cn("space-y-5 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AnalysisKpiCard id="sales-quantity" label="Quantité totale vendue" value={number.format(shown.totals.quantity)} hint={QUANTITY_HINT} emphasis={metric === "quantity"} accent="bg-sky-300" />
            <AnalysisKpiCard id="sales-revenue" label="Chiffre d'affaires total (HT)" value={formatCurrency(shown.totals.revenue)} hint={REVENUE_HINT} emphasis={metric === "revenue"} />
            <AnalysisKpiCard id="sales-margin" label="Marge totale" value={formatCurrency(shown.totals.margin)} hint={MARGIN_HINT} emphasis={metric === "margin"} accent="bg-violet-300" />
            <AnalysisKpiCard id="sales-products" label="Produits distincts vendus" value={number.format(shown.totals.distinctProducts)} hint="Nombre de produits ayant au moins une ligne de vente validée sur la période et les filtres choisis." accent="bg-amber-300" />
          </div>

          {shown.dataQuality.truckSalesWithoutDriver.count > 0 ? (
            <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {shown.dataQuality.truckSalesWithoutDriver.count} vente(s) camion du mois ({formatCurrency(shown.dataQuality.truckSalesWithoutDriver.revenue)} HT) n&apos;ont pas de chauffeur enregistré :
              elles sont attribuées à l&apos;utilisateur qui les a enregistrées.
            </p>
          ) : null}
          {shown.dataQuality.returnLinesWithoutCost > 0 ? (
            <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {shown.dataQuality.returnLinesWithoutCost} ligne(s) d&apos;avoir ne sont pas liées à une ligne de vente : leur montant est déduit du chiffre d&apos;affaires, mais leur coût
              d&apos;achat ne peut pas être restitué (marge légèrement sous-estimée).
            </p>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-foreground">Comparaison des utilisateurs</h3>
              <InfoHint label="Comparaison des utilisateurs" text={SELLER_HINT} />
            </div>
            {shown.byUser.length === 0 ? (
              <EmptyAnalysis>Aucune vente pour ces utilisateurs sur cette période.</EmptyAnalysis>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border">
                <Table data-table="users">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Utilisateur</TableHead>
                      <SortHead label="Quantité" metricKey="quantity" sort={sort} onSort={toggleSort} align="right" />
                      <SortHead label="CA HT" metricKey="revenue" sort={sort} onSort={toggleSort} align="right" />
                      <SortHead label="Marge" metricKey="margin" sort={sort} onSort={toggleSort} align="right" />
                      <TableHead className="text-right">Produits distincts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.byUser.map((row) => (
                      <TableRow key={row.userId} data-user-id={row.userId}>
                        <TableCell className="font-medium text-foreground">{row.userName}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", metric === "quantity" && "font-semibold")}>{number.format(row.quantity)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", metric === "revenue" && "font-semibold")}>{formatCurrency(row.revenue)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", metric === "margin" && "font-semibold")}>{formatCurrency(row.margin)}</TableCell>
                        <TableCell className="text-right tabular-nums">{number.format(row.productCount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-foreground">Produits vendus</h3>
              <InfoHint label="Produits vendus" text="Une ligne par produit : les lignes de facture du même produit sur la période sont additionnées. Cliquez sur un en-tête pour trier." />
            </div>
            {shown.products.length === 0 ? (
              <EmptyAnalysis>
                {filtered ? "Aucune vente ne correspond à ces filtres sur cette période." : "Aucune vente sur cette période."}
              </EmptyAnalysis>
            ) : (
              <>
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <Table data-table="products">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produit</TableHead>
                        <TableHead>Fournisseur</TableHead>
                        <SortHead label="Quantité vendue" metricKey="quantity" sort={sort} onSort={toggleSort} align="right" />
                        <SortHead label="Chiffre d'affaires" metricKey="revenue" sort={sort} onSort={toggleSort} align="right" />
                        <SortHead label="Marge" metricKey="margin" sort={sort} onSort={toggleSort} align="right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.rows.map((row) => (
                        <TableRow key={row.productId} data-product-id={row.productId}>
                          <TableCell>
                            <p className="font-medium text-foreground">{row.name}</p>
                            {row.reference ? <p className="text-xs text-muted-foreground">{row.reference}</p> : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{row.supplierName ?? "Sans fournisseur"}</TableCell>
                          <MetricCell value={number.format(row.quantity)} ratio={metric === "quantity" && maxMain ? Math.abs(row.quantity) / maxMain : 0} main={metric === "quantity"} />
                          <MetricCell value={formatCurrency(row.revenue)} ratio={metric === "revenue" && maxMain ? Math.abs(row.revenue) / maxMain : 0} main={metric === "revenue"} />
                          <MetricCell value={formatCurrency(row.margin)} ratio={metric === "margin" && maxMain ? Math.abs(row.margin) / maxMain : 0} main={metric === "margin"} negative={row.margin < 0} />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span data-products-count>
                    {visible.rows.length} produit(s) affiché(s) sur {number.format(shown.productRowCount)}
                    {shown.truncated ? ` (les ${number.format(shown.products.length)} premiers selon le tri ; les indicateurs couvrent tous les produits)` : ""}
                  </span>
                  {visible.hiddenCount > 0 ? (
                    <Button type="button" variant="outline" size="sm" aria-expanded={false} onClick={() => setProductsExpanded(true)}>
                      Voir tous les produits ({number.format(shown.products.length)})
                      <ChevronDown aria-hidden="true" className="size-4" />
                    </Button>
                  ) : productsExpanded && shown.products.length > PRODUCTS_PREVIEW_COUNT ? (
                    <Button type="button" variant="outline" size="sm" aria-expanded onClick={() => setProductsExpanded(false)}>
                      Réduire
                      <ChevronUp aria-hidden="true" className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground italic">
            Toutes les ventes validées (camion et comptoir), attribuées à leur vendeur : le chauffeur de la vente, sinon l&apos;utilisateur qui l&apos;a enregistrée. Montants HT. Hors
            annulées et brouillons ; retours = avoirs clients validés, comptés dans le mois de leur validation et attribués au vendeur de la vente d&apos;origine. Le coût d&apos;achat est celui
            enregistré à la vente ; pour les ventes plus anciennes que cet enregistrement, la marge est une estimation.
          </p>
        </div>
      ) : null}
    </SectionCard>
  );
}

function SortHead({
  label,
  metricKey,
  sort,
  onSort,
  align,
}: {
  label: string;
  metricKey: SalesMetric;
  sort: { key: SalesMetric; direction: SortDirection };
  onSort: (key: SalesMetric) => void;
  align?: "right";
}) {
  const active = sort.key === metricKey;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(metricKey)}
        className={cn("inline-flex items-center gap-1 text-left font-semibold", align === "right" && "w-full justify-end", !active && "text-muted-foreground")}
      >
        {label}
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
    </TableHead>
  );
}

function MetricCell({ value, ratio, main, negative }: { value: string; ratio: number; main: boolean; negative?: boolean }) {
  return (
    <TableCell className={cn("relative text-right tabular-nums", main && "font-semibold text-foreground", negative && "text-red-600")}>
      {main && ratio > 0 ? (
        <span aria-hidden="true" className="absolute inset-y-1.5 right-0 -z-0 rounded-l bg-emerald-100/70" style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }} />
      ) : null}
      <span className="relative">{value}</span>
    </TableCell>
  );
}
