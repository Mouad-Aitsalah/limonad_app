"use client";

import * as React from "react";
import Link from "next/link";
import { Banknote, Search, Users, Wallet } from "lucide-react";

import { SalesPagination } from "@/components/ventes/sales-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { CustomerBalancesPageDto } from "@/types/customer-balance";

const SEARCH_DEBOUNCE_MS = 350;
const PAGE_SIZE = 25;

type CustomerBalancesViewProps = {
  initialPage: CustomerBalancesPageDto;
};

export function CustomerBalancesView({ initialPage }: CustomerBalancesViewProps) {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [includeSettled, setIncludeSettled] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<CustomerBalancesPageDto>(initialPage);
  const [loading, setLoading] = React.useState(false);
  const skipNextFetch = React.useRef(true);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  function handleSearchChange(next: string) {
    setSearch(next);
    setPage(1);
  }

  function handleIncludeSettledChange(next: boolean) {
    setIncludeSettled(next);
    setPage(1);
  }

  React.useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch.trim()) query.set("search", debouncedSearch.trim());
    if (includeSettled) query.set("includeSettled", "1");
    fetch(`/api/customer-balances?${query.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("load failed"))))
      .then((body: CustomerBalancesPageDto) => setData(body))
      .catch((error) => {
        if (error.name !== "AbortError") {
          // Keep the previous page visible on a transient failure.
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [page, debouncedSearch, includeSettled]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          icon={Users}
          label="Clients avec solde"
          value={data.debtorCount.toLocaleString("fr-FR")}
        />
        <KpiCard
          icon={Wallet}
          label="Total dû"
          value={formatCurrency(data.totalOutstanding)}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Rechercher par nom, N° compte ou N° client..."
            aria-label="Rechercher un client"
            className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeSettled}
            onChange={(event) => handleIncludeSettledChange(event.target.checked)}
            className="h-4 w-4 rounded border-input accent-emerald-600"
          />
          Afficher les clients soldés
        </label>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N° compte</TableHead>
                <TableHead>Nom du compte</TableHead>
                <TableHead className="text-right">Solde</TableHead>
                <TableHead>Créé par</TableHead>
                <TableHead className="text-right">Règlement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                    {loading ? "Chargement…" : "Aucun client à afficher."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((row) => {
                  // Same rule Règlements clients itself enforces (see
                  // CustomerSettlementsView's `noDebt`): a settled customer
                  // (balance 0, only ever shown via "Afficher les clients
                  // soldés") has nothing to collect, so the action is
                  // disabled here instead of linking to a dead-end form.
                  const canSettle = row.balance > 0;
                  return (
                    <TableRow key={row.customerId}>
                      <TableCell className="font-medium tabular-nums text-foreground">
                        {row.accountCode}
                      </TableCell>
                      <TableCell className="text-foreground">{row.accountName}</TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          row.balance > 0 ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(row.balance)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.createdByUserName}</TableCell>
                      <TableCell className="text-right">
                        {canSettle ? (
                          <Link
                            href={`/comptabilite/reglements-clients?customerId=${row.customerId}`}
                            className={cn(
                              buttonVariants({ variant: "outline", size: "sm" }),
                              "gap-1.5",
                            )}
                          >
                            <Banknote aria-hidden="true" className="h-4 w-4" />
                            <span className="hidden sm:inline">Régler</span>
                          </Link>
                        ) : (
                          <span
                            aria-disabled="true"
                            title="Ce client n'a aucune créance à régler."
                            className={cn(
                              buttonVariants({ variant: "outline", size: "sm" }),
                              "gap-1.5 pointer-events-none opacity-40",
                            )}
                          >
                            <Banknote aria-hidden="true" className="h-4 w-4" />
                            <span className="hidden sm:inline">Régler</span>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {data.totalCount.toLocaleString("fr-FR")} client{data.totalCount > 1 ? "s" : ""}
          {" "}au total
        </p>
        <SalesPagination page={data.page} totalPages={data.pageCount} onPageChange={setPage} />
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
}) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="font-heading text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
