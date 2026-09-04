"use client";

import * as React from "react";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";

import { AccountDialog } from "@/components/comptes/account-dialog";
import {
  AccountsTable,
  type AccountsSortKey,
  type AccountsSortState,
} from "@/components/comptes/accounts-table";
import { AccountsToolbar } from "@/components/comptes/accounts-toolbar";
import { useAccountsPage } from "@/components/comptes/use-accounts-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AccountingAccountOptionDto } from "@/types/accounting";
import type { BusinessAccountListItem, BusinessAccountsPageDto } from "@/types/business-account";

const ACCOUNTS_SEARCH_DEBOUNCE_MS = 400;

type AccountsViewProps = {
  initialPage: BusinessAccountsPageDto;
  accountingAccounts: AccountingAccountOptionDto[];
};

export function AccountsView({ initialPage, accountingAccounts }: AccountsViewProps) {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), ACCOUNTS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const [type, setType] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [city, setCity] = React.useState("all");
  const [editingAccount, setEditingAccount] = React.useState<BusinessAccountListItem | null>(null);
  const [sort, setSort] = React.useState<AccountsSortState>({
    key: "createdAt",
    direction: "desc",
  });

  const {
    items: accounts,
    summary,
    cities,
    pageIndex,
    hasMore,
    hasPrevious,
    loading,
    goToNextPage,
    goToPreviousPage,
    refetchCurrentPage,
  } = useAccountsPage({ search: debouncedSearch, type, status, city }, initialPage);

  // Server page is already createdAt-desc/id-desc ordered and filtered; this
  // only re-sorts the current, page-sized (<=100 rows) batch when the user
  // clicks a column header - the same instant, client-side re-sort UX as
  // before, just scoped to one page instead of the whole (once unbounded)
  // dataset.
  const sortedAccounts = React.useMemo(() => {
    const collator = new Intl.Collator("fr-FR", { sensitivity: "base" });
    return [...accounts].sort((left, right) => {
      const factor = sort.direction === "asc" ? 1 : -1;

      switch (sort.key) {
        case "accountNumber":
          return factor * collator.compare(left.accountNumber, right.accountNumber);
        case "name":
          return factor * collator.compare(left.name, right.name);
        case "type":
          return factor * collator.compare(left.type, right.type);
        case "creditLimit":
          return factor * ((left.creditLimit ?? -1) - (right.creditLimit ?? -1));
        case "createdAt":
          return factor * (new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
        default:
          return 0;
      }
    });
  }, [accounts, sort]);

  function handleSortChange(key: AccountsSortKey) {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : {
            key,
            direction: key === "createdAt" ? "desc" : "asc",
          },
    );
  }

  async function refreshAccounts() {
    await refetchCurrentPage();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Comptes
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestion des comptes clients, fournisseurs, charges, tresorerie et comptes employes.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            render={<Link href="/comptes/import" />}
          >
            <FileSpreadsheet aria-hidden="true" className="h-4 w-4" />
            Importer des comptes
          </Button>
          <AccountDialog accountingAccounts={accountingAccounts} onSaved={refreshAccounts} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="Total comptes" value={String(summary.totalCount)} />
        <SummaryCard label="Clients" value={String(summary.customerCount)} />
        <SummaryCard label="Fournisseurs" value={String(summary.supplierCount)} />
        <SummaryCard label="Charges" value={String(summary.expenseCount)} />
        <SummaryCard label="Tresorerie" value={String(summary.treasuryCount)} />
        <SummaryCard label="Employes" value={String(summary.employeeCount)} />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <AccountsToolbar
            search={search}
            onSearchChange={setSearch}
            type={type}
            onTypeChange={setType}
            status={status}
            onStatusChange={setStatus}
            city={city}
            onCityChange={setCity}
            cities={cities}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Page {pageIndex + 1} &middot; {sortedAccounts.length} compte
              {sortedAccounts.length > 1 ? "s" : ""} sur cette page &middot; {summary.totalCount} au total
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasPrevious || loading}
                onClick={goToPreviousPage}
              >
                Precedent
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasMore || loading}
                onClick={goToNextPage}
              >
                Suivant
              </Button>
            </div>
          </div>

          <AccountsTable
            accounts={sortedAccounts}
            sort={sort}
            onSortChange={handleSortChange}
            onEdit={setEditingAccount}
          />
        </CardContent>
      </Card>

      <AccountDialog
        account={editingAccount}
        accountingAccounts={accountingAccounts}
        open={editingAccount !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingAccount(null);
          }
        }}
        onSaved={refreshAccounts}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
