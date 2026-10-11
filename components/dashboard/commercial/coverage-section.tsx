"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import {
  AnalysisKpiCard,
  AnalysisState,
  EmptyAnalysis,
  FilterField,
  OptionSelect,
} from "@/components/dashboard/commercial/analysis-ui";
import { useAnalysisData } from "@/components/dashboard/commercial/use-analysis-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sortCoverageDrivers, type CoverageDriverSortKey } from "@/lib/commercial-analysis/coverage";
import { currentWeekParam, formatDayFr, shiftWeek } from "@/lib/commercial-analysis/period";
import { cn, formatCurrency } from "@/lib/utils";
import type { CoverageDto } from "@/types/commercial-analysis";

const RATE_HINT =
  "Taux de couverture = clients du portefeuille ayant au moins un achat valide auprès du chauffeur pendant la semaine ÷ tous les clients du portefeuille × 100. Un client est compté une seule fois, même s'il achète plusieurs fois ; les clients non visités restent au dénominateur.";
const PORTFOLIO_HINT =
  "Portefeuille = clients actifs créés par le chauffeur (même règle que le POS chauffeur) et existant à la fin de la semaine. Il n'existe pas d'historique d'affectation : un client appartient à son seul chauffeur créateur.";

type CustomerFilter = "all" | "BOUGHT" | "NO_PURCHASE";
const PAGE = 100;
const number = new Intl.NumberFormat("fr-FR");
const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Casablanca" });

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const dayWithName = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${formatDayFr(day)}`;
};

export function CoverageSection() {
  const [driverId, setDriverId] = React.useState("all");
  const [week, setWeek] = React.useState(currentWeekParam());
  const [customerFilter, setCustomerFilter] = React.useState<CustomerFilter>("all");
  const [visible, setVisible] = React.useState(PAGE);
  const [driverSort, setDriverSort] = React.useState<{ key: CoverageDriverSortKey; direction: "asc" | "desc" }>({ key: "rate", direction: "asc" });

  const url = `/api/dashboard/coverage?${new URLSearchParams({ driverId, week }).toString()}`;
  const { loading, data, lastData, error, retry } = useAnalysisData<CoverageDto>(url);
  const shown = data ?? lastData;
  const thisWeek = currentWeekParam();

  const driverOptions = [{ value: "all", label: "Tous les chauffeurs" }, ...(shown?.drivers ?? []).map((d) => ({ value: d.id, label: d.name }))];

  const customers = React.useMemo(
    () => (shown?.customers ?? []).filter((row) => customerFilter === "all" || row.status === customerFilter),
    [shown, customerFilter],
  );
  const drivers = React.useMemo(
    () => (shown?.byDriver ? sortCoverageDrivers(shown.byDriver, driverSort.key, driverSort.direction) : null),
    [shown, driverSort],
  );

  function selectDriver(next: string) {
    setDriverId(next);
    setCustomerFilter("all");
    setVisible(PAGE);
  }
  function toggleDriverSort(key: CoverageDriverSortKey) {
    setDriverSort((current) => (current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "rate" ? "asc" : "desc" }));
  }

  const summary = shown?.summary;

  return (
    <SectionCard
      title="Couverture commerciale"
      description="Part des clients du portefeuille d'un chauffeur qui ont acheté au moins une fois pendant la semaine."
      contentClassName="space-y-5"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-end">
        <FilterField label="Chauffeur">
          <OptionSelect ariaLabel="Chauffeur" value={driverId} options={driverOptions} onChange={selectDriver} />
        </FilterField>
        <FilterField label="Semaine (lundi → dimanche)">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" aria-label="Semaine précédente" onClick={() => { setWeek(shiftWeek(week, -1)); setVisible(PAGE); }}>
              <ChevronLeft aria-hidden="true" className="size-4" />
              Précédente
            </Button>
            <Button type="button" variant="outline" size="sm" aria-label="Semaine suivante" disabled={week >= thisWeek} onClick={() => { setWeek(shiftWeek(week, 1)); setVisible(PAGE); }}>
              Suivante
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={week === thisWeek} onClick={() => { setWeek(thisWeek); setVisible(PAGE); }}>
              Cette semaine
            </Button>
          </div>
        </FilterField>
      </div>

      {shown ? (
        <p className="text-sm text-muted-foreground" data-period>
          <span className="font-medium text-foreground">
            Du {dayWithName(shown.period.fromDay)} au {dayWithName(shown.period.toDay)}
          </span>
          {shown.period.isCurrentWeek ? " · semaine en cours (non terminée)" : ""} (journées commerciales, 02:00 → 02:00)
        </p>
      ) : null}

      <AnalysisState loading={loading} error={error} onRetry={retry} />

      {shown && summary ? (
        <div className={cn("space-y-5 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AnalysisKpiCard id="coverage-assigned" label="Clients affectés" value={number.format(summary.assigned)} hint={PORTFOLIO_HINT} accent="bg-sky-300" />
            <AnalysisKpiCard id="coverage-buyers" label="Clients ayant acheté" value={number.format(summary.buyers)} hint="Clients distincts du portefeuille avec au moins une vente validée du chauffeur pendant la semaine." />
            <AnalysisKpiCard id="coverage-without" label="Clients sans achat" value={number.format(summary.withoutPurchase)} hint="Clients du portefeuille sans aucune vente validée pendant la semaine (visités ou non)." accent="bg-amber-300" />
            <AnalysisKpiCard
              id="coverage-rate"
              label="Taux de couverture"
              value={summary.rate === null ? "—" : `${summary.rate.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %`}
              hint={RATE_HINT}
              emphasis
              accent="bg-violet-300"
            />
          </div>

          <div aria-label="Taux de couverture" data-coverage-bar>
            {summary.rate === null ? null : (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={summary.rate}
                aria-label={`Taux de couverture : ${summary.rate} %`}
                className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
              >
                <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${summary.rate}%` }} />
              </div>
            )}
          </div>

          {shown.outsidePortfolio.sales > 0 ? (
            <p role="note" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {shown.outsidePortfolio.customers} client(s) hors portefeuille ont aussi acheté cette semaine ({shown.outsidePortfolio.sales} vente(s) : clients créés par l&apos;administration ou par un
              autre chauffeur). Ils ne comptent pas dans le taux.
            </p>
          ) : null}

          {summary.assigned === 0 ? (
            <EmptyAnalysis>
              {driverId === "all"
                ? "Aucun client n'est affecté à un chauffeur : le taux de couverture n'est pas calculable."
                : "Aucun client n'est affecté à ce chauffeur : le taux de couverture n'est pas calculable."}
            </EmptyAnalysis>
          ) : null}

          {drivers && drivers.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Comparaison des chauffeurs</h3>
              <div className="overflow-x-auto rounded-2xl border border-border">
                <Table data-table="coverage-drivers">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chauffeur</TableHead>
                      <TableHead className="text-right">Clients affectés</TableHead>
                      <CoverageSortHead label="Clients acheteurs" sortKey="buyers" sort={driverSort} onSort={toggleDriverSort} />
                      <CoverageSortHead label="Clients sans achat" sortKey="withoutPurchase" sort={driverSort} onSort={toggleDriverSort} />
                      <CoverageSortHead label="Taux de couverture" sortKey="rate" sort={driverSort} onSort={toggleDriverSort} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drivers.map((row) => (
                      <TableRow key={row.driverId}>
                        <TableCell>
                          <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => selectDriver(row.driverId)}>
                            {row.driverName}
                          </button>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{number.format(row.assigned)}</TableCell>
                        <TableCell className="text-right tabular-nums">{number.format(row.buyers)}</TableCell>
                        <TableCell className="text-right tabular-nums">{number.format(row.withoutPurchase)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {row.rate === null ? <span className="font-normal text-muted-foreground">Aucun client</span> : `${row.rate.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          {driverId !== "all" && summary.assigned > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Clients du portefeuille</h3>
                <div role="group" aria-label="Filtrer les clients" className="inline-flex rounded-xl border border-border bg-muted/30 p-1">
                  {(
                    [
                      ["all", `Tous (${shown.customers.length})`],
                      ["BOUGHT", `Acheteurs (${summary.buyers})`],
                      ["NO_PURCHASE", `Sans achat (${summary.withoutPurchase})`],
                    ] as Array<[CustomerFilter, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={customerFilter === value}
                      onClick={() => { setCustomerFilter(value); setVisible(PAGE); }}
                      className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap", customerFilter === value ? "bg-white text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {customers.length === 0 ? (
                <EmptyAnalysis>Aucun client dans cette sélection.</EmptyAnalysis>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-2xl border border-border">
                    <Table data-table="coverage-customers">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Client</TableHead>
                          <TableHead>Statut de la semaine</TableHead>
                          <TableHead className="text-right">Ventes</TableHead>
                          <TableHead className="text-right">Montant acheté (TTC)</TableHead>
                          <TableHead>Dernier achat</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customers.slice(0, visible).map((row) => (
                          <TableRow key={row.customerId} data-customer-id={row.customerId}>
                            <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={row.status === "BOUGHT" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}>
                                {row.status === "BOUGHT" ? "Achat réalisé" : "Aucun achat"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{row.status === "BOUGHT" ? number.format(row.salesCount) : "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.status === "BOUGHT" ? formatCurrency(row.amount) : "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{row.lastPurchaseAt ? dateTime.format(new Date(row.lastPurchaseAt)) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {Math.min(visible, customers.length)} / {customers.length} client(s) affichés
                    </span>
                    {visible < customers.length ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setVisible((value) => value + PAGE)}>
                        Afficher plus
                      </Button>
                    ) : null}
                    {shown.customersTruncated ? <span>Liste limitée aux 2 000 premiers clients ; les indicateurs couvrent tout le portefeuille.</span> : null}
                  </div>
                </>
              )}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground italic">
            Semaines calendaires du lundi au dimanche. Achat valide = vente validée du chauffeur (hors annulée et brouillon). Le portefeuille est celui d&apos;aujourd&apos;hui : les changements de
            statut d&apos;un client (désactivation) ne sont pas historisés, et un client n&apos;appartient qu&apos;à son chauffeur créateur.
          </p>
        </div>
      ) : null}
    </SectionCard>
  );
}

function CoverageSortHead({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: CoverageDriverSortKey;
  sort: { key: CoverageDriverSortKey; direction: "asc" | "desc" };
  onSort: (key: CoverageDriverSortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className="text-right" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(sortKey)} className={cn("inline-flex w-full items-center justify-end gap-1 font-semibold", !active && "text-muted-foreground")}>
        {label}
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
    </TableHead>
  );
}

