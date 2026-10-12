"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";

import { EmptyAnalysis, FilterField, InfoHint, OptionSelect } from "@/components/dashboard/commercial/analysis-ui";
import { CASH_NOTE_HINT, formatDay, formatDays, statusLabel } from "@/components/dashboard/receivables/receivables-format";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEBTOR_FILTERS, selectDebtors, type DebtorFilter, type DebtorSortKey, type SortDirection } from "@/lib/receivables/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { ReceivablesDebtorRow } from "@/types/receivables";

const PAGE = 50;

/** The debtors, searchable / filterable / sortable; a row opens the customer's movements. */
export function ReceivablesDebtorsTable({
  rows,
  overdueDays,
  onOpenCustomer,
}: {
  rows: readonly ReceivablesDebtorRow[];
  overdueDays: number;
  onOpenCustomer: (customerId: string) => void;
}) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<DebtorFilter>("all");
  const [sort, setSort] = React.useState<{ key: DebtorSortKey; direction: SortDirection }>({ key: "balance", direction: "desc" });
  const [limit, setLimit] = React.useState(PAGE);

  const selected = React.useMemo(
    () => selectDebtors(rows, { search, filter, sort: sort.key, direction: sort.direction }),
    [rows, search, filter, sort],
  );
  const shown = selected.slice(0, limit);

  function toggleSort(key: DebtorSortKey) {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === "desc" ? "asc" : "desc" } : { key, direction: key === "name" ? "asc" : "desc" },
    );
  }

  function header(key: DebtorSortKey, label: string, align: "left" | "right" = "right") {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.direction === "desc" ? ArrowDown : ArrowUp;
    return (
      <TableHead className={cn(align === "right" && "text-right")} aria-sort={active ? (sort.direction === "desc" ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={cn("inline-flex items-center gap-1 font-semibold hover:text-foreground", align === "right" && "flex-row-reverse")}
        >
          {label}
          <Icon aria-hidden="true" className={cn("size-3.5", active ? "text-foreground" : "text-muted-foreground/60")} />
        </button>
      </TableHead>
    );
  }

  return (
    <div className="space-y-3" data-table="receivables-debtors">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_240px]">
        <FilterField label="Recherche">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLimit(PAGE);
              }}
              placeholder="Nom, code ou n° de compte"
              aria-label="Rechercher un client débiteur"
              className="pl-9"
            />
          </div>
        </FilterField>
        <FilterField label="Filtre">
          <OptionSelect
            ariaLabel="Filtrer les clients débiteurs"
            value={filter}
            options={DEBTOR_FILTERS}
            onChange={(value) => {
              setFilter(value as DebtorFilter);
              setLimit(PAGE);
            }}
          />
        </FilterField>
      </div>

      {selected.length === 0 ? (
        <EmptyAnalysis>
          {rows.length === 0 ? "Aucun client débiteur." : "Aucun client débiteur ne correspond à la recherche ou au filtre."}
        </EmptyAnalysis>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  {header("name", "Client", "left")}
                  {header("balance", "Solde dû")}
                  {header("overdue", `En retard (> ${overdueDays} j)`)}
                  {header("over30", "Plus de 30 j")}
                  {header("oldest", "Plus ancienne")}
                  <TableHead className="text-right">Dernier règlement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow
                    key={row.customerId}
                    data-customer={row.customerId}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => onOpenCustomer(row.customerId)}
                  >
                    <TableCell>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenCustomer(row.customerId);
                        }}
                        className="text-left font-medium text-foreground hover:underline"
                        aria-label={`Voir les mouvements de ${row.name}`}
                      >
                        {row.name}
                      </button>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-muted-foreground">
                        <span>Compte {row.accountCode}</span>
                        {row.status !== "ACTIVE" ? <span className="rounded bg-muted px-1.5">{statusLabel(row.status)}</span> : null}
                        {row.cashCreditNotesTotal > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 text-amber-900">
                            Avoirs « espèces » {formatCurrency(row.cashCreditNotesTotal)}
                            <InfoHint label="Avoirs « espèces »" text={CASH_NOTE_HINT} />
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(row.balance)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", row.overdue > 0 ? "text-red-700" : "text-muted-foreground")}>
                      {row.overdue > 0 ? formatCurrency(row.overdue) : "—"}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", row.over30 > 0 ? "text-orange-700" : "text-muted-foreground")}>
                      {row.over30 > 0 ? formatCurrency(row.over30) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatDays(row.oldestOpenAgeDays)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatDay(row.lastSettlementDay)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {shown.length} sur {selected.length} client{selected.length > 1 ? "s" : ""}
            </span>
            {selected.length > shown.length ? (
              <button type="button" onClick={() => setLimit((value) => value + PAGE)} className="rounded-lg border border-border px-3 py-1 font-semibold text-foreground hover:bg-muted/40">
                Afficher plus
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
