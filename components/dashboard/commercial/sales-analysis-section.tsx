"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import {
  AnalysisKpiCard,
  AnalysisState,
  EmptyAnalysis,
  FilterField,
  InfoHint,
  OptionSelect,
} from "@/components/dashboard/commercial/analysis-ui";
import { useAnalysisData } from "@/components/dashboard/commercial/use-analysis-data";
import { SectionCard } from "@/components/ui/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentMonthParam, formatDayFr, recentMonths } from "@/lib/commercial-analysis/period";
import { cn, formatCurrency } from "@/lib/utils";
import type { SalesAnalysisDto, SalesMetric, SortDirection } from "@/types/commercial-analysis";

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

const number = new Intl.NumberFormat("fr-FR");

export function SalesAnalysisSection() {
  const months = React.useMemo(() => recentMonths(24), []);
  const [driverId, setDriverId] = React.useState("all");
  const [month, setMonth] = React.useState(currentMonthParam());
  const [supplierId, setSupplierId] = React.useState("all");
  const [metric, setMetric] = React.useState<SalesMetric>("revenue");
  // the table's own sort: follows the main indicator until the user clicks a column
  const [sortOverride, setSortOverride] = React.useState<{ key: SalesMetric; direction: SortDirection } | null>(null);
  const sort = sortOverride ?? { key: metric, direction: "desc" as SortDirection };

  const url = `/api/dashboard/sales-analysis?${new URLSearchParams({
    driverId,
    month,
    supplierId,
    metric,
    sort: sort.key,
    direction: sort.direction,
  }).toString()}`;
  const { loading, data, lastData, error, retry } = useAnalysisData<SalesAnalysisDto>(url);
  const shown = data ?? lastData;

  const driverOptions = [{ value: "all", label: "Tous les chauffeurs" }, ...(shown?.drivers ?? []).map((d) => ({ value: d.id, label: d.name }))];
  const supplierOptions = [
    { value: "all", label: "Tous les fournisseurs" },
    { value: "none", label: "Sans fournisseur" },
    ...(shown?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];
  const monthOptions = months.some((m) => m.value === month) ? months : [{ value: month, label: month }, ...months];

  function toggleSort(key: SalesMetric) {
    setSortOverride((current) => {
      const active = current ?? { key: metric, direction: "desc" as SortDirection };
      return active.key === key
        ? { key, direction: active.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" };
    });
  }

  const maxMain = Math.max(0, ...(shown?.products ?? []).map((row) => Math.abs(row[metric])));
  const filtered = driverId !== "all" || supplierId !== "all";

  return (
    <SectionCard
      title="Analyse des ventes"
      description="Ventes validées des chauffeurs, par produit et par fournisseur, nettes des retours."
      contentClassName="space-y-5"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
        <FilterField label="Chauffeur">
          <OptionSelect ariaLabel="Chauffeur" value={driverId} options={driverOptions} onChange={(v) => { setDriverId(v); }} />
        </FilterField>
        <FilterField label="Mois">
          <OptionSelect ariaLabel="Mois" value={month} options={monthOptions} onChange={setMonth} />
        </FilterField>
        <FilterField label="Fournisseur">
          <OptionSelect ariaLabel="Fournisseur" value={supplierId} options={supplierOptions} onChange={setSupplierId} />
        </FilterField>
        <FilterField label="Indicateur principal" className="sm:col-span-2 xl:col-span-1">
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
              elles ne sont attribuées à aucun chauffeur et ne figurent pas dans ces chiffres.
            </p>
          ) : null}
          {shown.dataQuality.returnLinesWithoutCost > 0 ? (
            <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {shown.dataQuality.returnLinesWithoutCost} ligne(s) d&apos;avoir ne sont pas liées à une ligne de vente : leur montant est déduit du chiffre d&apos;affaires, mais leur coût
              d&apos;achat ne peut pas être restitué (marge légèrement sous-estimée).
            </p>
          ) : null}

          {shown.byDriver ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Comparaison des chauffeurs</h3>
              {shown.byDriver.length === 0 ? (
                <EmptyAnalysis>Aucune vente de chauffeur sur cette période.</EmptyAnalysis>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <Table data-table="drivers">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Chauffeur</TableHead>
                        <SortHead label="Quantité" metricKey="quantity" sort={sort} onSort={toggleSort} align="right" />
                        <SortHead label="CA HT" metricKey="revenue" sort={sort} onSort={toggleSort} align="right" />
                        <SortHead label="Marge" metricKey="margin" sort={sort} onSort={toggleSort} align="right" />
                        <TableHead className="text-right">Produits distincts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shown.byDriver.map((row) => (
                        <TableRow key={row.driverId}>
                          <TableCell className="font-medium text-foreground">{row.driverName}</TableCell>
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
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-foreground">Produits vendus</h3>
              <InfoHint label="Produits vendus" text="Une ligne par produit : les lignes de facture du même produit sur la période sont additionnées. Cliquez sur un en-tête pour trier." />
            </div>
            {shown.products.length === 0 ? (
              <EmptyAnalysis>
                {filtered ? "Aucune vente ne correspond à ces filtres sur cette période." : "Aucune vente de chauffeur sur cette période."}
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
                      {shown.products.map((row) => (
                        <TableRow key={row.productId} data-product-id={row.productId}>
                          <TableCell>
                            <p className="font-medium text-foreground">{row.name}</p>
                            {row.reference ? <p className="text-xs text-muted-foreground">{row.reference}</p> : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{row.supplierName ?? "—"}</TableCell>
                          <MetricCell value={number.format(row.quantity)} ratio={metric === "quantity" && maxMain ? Math.abs(row.quantity) / maxMain : 0} main={metric === "quantity"} />
                          <MetricCell value={formatCurrency(row.revenue)} ratio={metric === "revenue" && maxMain ? Math.abs(row.revenue) / maxMain : 0} main={metric === "revenue"} />
                          <MetricCell value={formatCurrency(row.margin)} ratio={metric === "margin" && maxMain ? Math.abs(row.margin) / maxMain : 0} main={metric === "margin"} negative={row.margin < 0} />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  {shown.truncated
                    ? `${number.format(shown.products.length)} premiers produits sur ${number.format(shown.productRowCount)} (selon le tri choisi). Les indicateurs ci-dessus couvrent tous les produits.`
                    : `${number.format(shown.productRowCount)} produit(s).`}
                </p>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground italic">
            Ventes camion des chauffeurs uniquement (les ventes au comptoir n&apos;ont pas de chauffeur). Montants HT. Ventes validées, hors annulées et brouillons ; retours = avoirs clients
            validés, comptés dans le mois de leur validation. Le coût d&apos;achat est celui enregistré à la vente ; pour les ventes plus anciennes que cet enregistrement, la marge est une estimation.
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
