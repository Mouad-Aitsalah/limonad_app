"use client";

import * as React from "react";

import { AccountDialog } from "@/components/comptes/account-dialog";
import {
  AccountsTable,
  type AccountsSortKey,
  type AccountsSortState,
} from "@/components/comptes/accounts-table";
import { AccountsToolbar } from "@/components/comptes/accounts-toolbar";
import { Card, CardContent } from "@/components/ui/card";
import type { AccountingAccountOptionDto } from "@/types/accounting";
import type {
  BusinessAccountListItem,
  BusinessAccountsSummaryDto,
} from "@/types/business-account";

type AccountsViewProps = {
  initialAccounts: BusinessAccountListItem[];
  initialSummary: BusinessAccountsSummaryDto;
  accountingAccounts: AccountingAccountOptionDto[];
};

export function AccountsView({
  initialAccounts,
  initialSummary,
  accountingAccounts,
}: AccountsViewProps) {
  const [accounts, setAccounts] = React.useState(initialAccounts);
  const [summary, setSummary] = React.useState(initialSummary);
  const [search, setSearch] = React.useState("");
  const [type, setType] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [city, setCity] = React.useState("all");
  const [editingAccount, setEditingAccount] = React.useState<BusinessAccountListItem | null>(null);
  const [sort, setSort] = React.useState<AccountsSortState>({
    key: "createdAt",
    direction: "desc",
  });

  const cities = React.useMemo(
    () =>
      [...new Set(accounts.map((account) => account.city).filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b), "fr-FR"),
      ) as string[],
    [accounts],
  );

  const filteredAccounts = React.useMemo(() => {
    const query = normalizeSearch(search);
    return accounts.filter((account) => {
      const matchesSearch =
        query.length === 0 ||
        normalizeSearch(
          `${account.accountNumber} ${account.name} ${account.phone ?? ""} ${account.email ?? ""}`,
        ).includes(query);

      const matchesType = type === "all" || account.type === type;
      const matchesStatus = status === "all" || account.status === status;
      const matchesCity = city === "all" || account.city === city;

      return matchesSearch && matchesType && matchesStatus && matchesCity;
    });
  }, [accounts, city, search, status, type]);

  const sortedAccounts = React.useMemo(() => {
    const collator = new Intl.Collator("fr-FR", { sensitivity: "base" });
    return [...filteredAccounts].sort((left, right) => {
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
  }, [filteredAccounts, sort]);

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
    const response = await fetch("/api/comptes", { cache: "no-store" });
    const payload = (await response.json()) as {
      items?: BusinessAccountListItem[];
      summary?: BusinessAccountsSummaryDto;
      message?: string;
    };
    if (!response.ok || !payload.items || !payload.summary) {
      throw new Error(payload.message ?? "Impossible de recharger les comptes.");
    }

    setAccounts(payload.items);
    setSummary(payload.summary);
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

        <AccountDialog accountingAccounts={accountingAccounts} onSaved={refreshAccounts} />
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

          <p className="text-sm text-muted-foreground">
            {sortedAccounts.length} compte{sortedAccounts.length > 1 ? "s" : ""}
          </p>

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

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}
