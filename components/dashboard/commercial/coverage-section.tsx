"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Users } from "lucide-react";

import {
  AnalysisKpiCard,
  AnalysisState,
  EmptyAnalysis,
  FilterField,
  InfoHint,
} from "@/components/dashboard/commercial/analysis-ui";
import { MultiSelectFilter, selectionParam, type MultiSelectOption } from "@/components/dashboard/commercial/multi-select-filter";
import { useAnalysisData } from "@/components/dashboard/commercial/use-analysis-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sortCoverageUsers, type CoverageUserSortKey } from "@/lib/commercial-analysis/coverage";
import { currentWeekParam, formatDayFr, shiftWeek } from "@/lib/commercial-analysis/period";
import { cn, formatCurrency } from "@/lib/utils";
import { UNASSIGNED, type CoverageDto, type CoverageSummary } from "@/types/commercial-analysis";

const RATE_HINT =
  "Taux de couverture = clients du portefeuille ayant au moins un achat valide auprès de son titulaire pendant la semaine ÷ tous les clients du portefeuille × 100. Un client est compté une seule fois, même s'il achète plusieurs fois ; les clients non visités restent au dénominateur.";
const PORTFOLIO_HINT =
  "Portefeuille d'un utilisateur = clients actifs créés par son profil chauffeur (même règle que le POS chauffeur) et existant à la fin de la semaine. Un client n'appartient qu'à un seul portefeuille : plusieurs utilisateurs sélectionnés sont additionnés sans double comptage. Les clients créés au bureau ou importés restent « Non attribués ».";
const UNASSIGNED_HINT =
  "Clients actifs sans chauffeur créateur (créés au bureau ou importés). Ils ne sont réattribués à personne ; « ayant acheté » = au moins une vente validée de n'importe quel utilisateur pendant la semaine.";

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
  const [userIds, setUserIds] = React.useState<string[]>([]);
  const [week, setWeek] = React.useState(currentWeekParam());
  const [customerFilter, setCustomerFilter] = React.useState<CustomerFilter>("all");
  const [visible, setVisible] = React.useState(PAGE);
  const [userSort, setUserSort] = React.useState<{ key: CoverageUserSortKey; direction: "asc" | "desc" }>({ key: "rate", direction: "asc" });

  const params = new URLSearchParams({ week });
  const userParam = selectionParam(userIds);
  if (userParam) params.set("userIds", userParam);
  const { loading, data, lastData, error, retry } = useAnalysisData<CoverageDto>(`/api/dashboard/coverage?${params.toString()}`);
  const shown = data ?? lastData;
  const thisWeek = currentWeekParam();

  const userOptions = React.useMemo<MultiSelectOption[]>(
    () => [
      { value: UNASSIGNED, label: "Non attribués", hint: "clients", special: true },
      ...(shown?.users ?? []).map((user) => ({ value: user.id, label: user.name, hint: user.isDriver ? "chauffeur" : undefined })),
    ],
    [shown?.users],
  );

  const customers = React.useMemo(
    () => (shown?.customers ?? []).filter((row) => customerFilter === "all" || row.status === customerFilter),
    [shown, customerFilter],
  );
  const users = React.useMemo(() => (shown ? sortCoverageUsers(shown.byUser, userSort.key, userSort.direction) : []), [shown, userSort]);
  const showOwner = userIds.length > 1;

  function selectUsers(next: string[]) {
    setUserIds(next);
    setCustomerFilter("all");
    setVisible(PAGE);
  }
  function toggleUserSort(key: CoverageUserSortKey) {
    setUserSort((current) => (current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "rate" ? "asc" : "desc" }));
  }

  const summary = shown?.summary;

  return (
    <SectionCard
      title="Couverture commerciale"
      description="Part des clients du portefeuille des utilisateurs sélectionnés qui ont acheté au moins une fois pendant la semaine."
      contentClassName="space-y-5"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
        <FilterField label="Utilisateurs">
          <MultiSelectFilter
            label="Utilisateurs"
            icon={Users}
            options={userOptions}
            value={userIds}
            onChange={selectUsers}
            allLabel="Tous les utilisateurs"
            plural="éléments"
          />
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
            <AnalysisKpiCard id="coverage-buyers" label="Clients ayant acheté" value={number.format(summary.buyers)} hint="Clients distincts du portefeuille avec au moins une vente validée de son titulaire pendant la semaine (comptés une seule fois)." />
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
              {`${shown.outsidePortfolio.customers} client(s) hors portefeuille du vendeur ont aussi acheté cette semaine (${shown.outsidePortfolio.sales} vente(s) : clients non attribués ou d'un autre portefeuille). Ils ne comptent pas dans le taux du vendeur.`}
            </p>
          ) : null}

          {summary.assigned === 0 ? (
            <EmptyAnalysis>
              {userIds.length === 0
                ? "Aucun client n'est affecté à un utilisateur : le taux de couverture n'est pas calculable."
                : "Aucun client n'est affecté à cette sélection : le taux de couverture n'est pas calculable."}
            </EmptyAnalysis>
          ) : null}

          {users.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Comparaison des utilisateurs</h3>
              <div className="overflow-x-auto rounded-2xl border border-border">
                <Table data-table="coverage-users">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Utilisateur</TableHead>
                      <TableHead className="text-right">Clients affectés</TableHead>
                      <CoverageSortHead label="Clients acheteurs" sortKey="buyers" sort={userSort} onSort={toggleUserSort} />
                      <CoverageSortHead label="Clients sans achat" sortKey="withoutPurchase" sort={userSort} onSort={toggleUserSort} />
                      <CoverageSortHead label="Taux de couverture" sortKey="rate" sort={userSort} onSort={toggleUserSort} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((row) => (
                      <TableRow key={row.userId} data-user-id={row.userId}>
                        <TableCell>
                          <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => selectUsers([row.userId])}>
                            {row.userName}
                          </button>
                        </TableCell>
                        <SummaryCells summary={row} />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          <div className="space-y-2" data-unassigned>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-foreground">Non attribués</h3>
              <InfoHint label="Non attribués" text={UNASSIGNED_HINT} />
              {userIds.includes(UNASSIGNED) ? null : <span className="text-xs text-muted-foreground">· hors du total ci-dessus</span>}
            </div>
            <div className="overflow-x-auto rounded-2xl border border-dashed border-border bg-slate-50/50">
              <Table data-table="coverage-unassigned">
                <TableHeader>
                  <TableRow>
                    <TableHead>Catégorie</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="text-right">Clients acheteurs</TableHead>
                    <TableHead className="text-right">Clients sans achat</TableHead>
                    <TableHead className="text-right">Taux d&apos;achat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => selectUsers([UNASSIGNED])}>
                        Non attribués
                      </button>
                    </TableCell>
                    <SummaryCells summary={shown.unassigned} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {userIds.length > 0 && summary.assigned > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Clients de la sélection</h3>
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
                          {showOwner ? <TableHead>Portefeuille</TableHead> : null}
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
                            {showOwner ? <TableCell className="text-muted-foreground">{row.ownerName ?? "Non attribué"}</TableCell> : null}
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
            Semaines calendaires du lundi au dimanche. Achat valide = vente validée (hors annulée et brouillon) du titulaire du portefeuille : le chauffeur de la vente, sinon
            l&apos;utilisateur qui l&apos;a enregistrée. Le portefeuille est celui d&apos;aujourd&apos;hui : les changements de statut d&apos;un client (désactivation) ne sont pas historisés, un
            client n&apos;appartient qu&apos;à son chauffeur créateur, et aucun client n&apos;est réattribué. Un utilisateur sans profil chauffeur n&apos;a pas de portefeuille.
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
  sortKey: CoverageUserSortKey;
  sort: { key: CoverageUserSortKey; direction: "asc" | "desc" };
  onSort: (key: CoverageUserSortKey) => void;
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

function SummaryCells({ summary }: { summary: CoverageSummary }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{number.format(summary.assigned)}</TableCell>
      <TableCell className="text-right tabular-nums">{number.format(summary.buyers)}</TableCell>
      <TableCell className="text-right tabular-nums">{number.format(summary.withoutPurchase)}</TableCell>
      <TableCell className="text-right tabular-nums font-semibold">
        {summary.rate === null ? <span className="font-normal text-muted-foreground">Aucun client</span> : `${summary.rate.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}
      </TableCell>
    </>
  );
}
