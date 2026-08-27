"use client";

import * as React from "react";
import { AlertTriangle, Search } from "lucide-react";

import {
  accountingJournalTypeLabels,
  accountingSourceTypeLabels,
} from "@/lib/accounting";
import { formatCurrency } from "@/lib/utils";
import type {
  AccountingAccountOptionDto,
  AccountingJournalLineDto,
  AccountingJournalType,
  AccountingSourceType,
} from "@/types/accounting";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AccountingJournalViewProps = {
  initialLines: AccountingJournalLineDto[];
  accounts: AccountingAccountOptionDto[];
  initialAccountId?: string | null;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("fr-FR");
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function AccountingJournalView({
  initialLines,
  accounts,
  initialAccountId,
}: AccountingJournalViewProps) {
  const [search, setSearch] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [journalType, setJournalType] = React.useState<"all" | AccountingJournalType>("all");
  const [accountId, setAccountId] = React.useState(initialAccountId ?? "all");
  const [sourceType, setSourceType] = React.useState<"all" | AccountingSourceType>("all");
  const [userFilter, setUserFilter] = React.useState("all");

  const users = React.useMemo(
    () =>
      [...new Set(initialLines.map((line) => line.createdByUserName).filter(Boolean))] as string[],
    [initialLines],
  );

  const filteredLines = React.useMemo(() => {
    const query = normalize(search);

    return initialLines.filter((line) => {
      const searchable = normalize(
        [
          line.operationNumber,
          line.entryNumber,
          line.invoiceNumber ?? "",
          line.checkNumber ?? "",
          line.partyName ?? "",
          line.reference ?? "",
          line.description,
          line.label,
          line.accountCode,
          line.accountName,
          line.createdByUserName ?? "",
          line.sourceType ? accountingSourceTypeLabels[line.sourceType] : "",
        ].join(" "),
      );

      const matchesSearch = query.length === 0 || searchable.includes(query);
      const lineDate = line.date.slice(0, 10);
      const matchesFrom = !from || lineDate >= from;
      const matchesTo = !to || lineDate <= to;
      const matchesJournal = journalType === "all" || line.journalType === journalType;
      const matchesAccount = accountId === "all" || line.accountId === accountId;
      const matchesSource = sourceType === "all" || line.sourceType === sourceType;
      const matchesUser = userFilter === "all" || line.createdByUserName === userFilter;

      return (
        matchesSearch &&
        matchesFrom &&
        matchesTo &&
        matchesJournal &&
        matchesAccount &&
        matchesSource &&
        matchesUser
      );
    });
  }, [accountId, from, initialLines, journalType, search, sourceType, to, userFilter]);

  const totalDebit = filteredLines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = filteredLines.reduce((sum, line) => sum + line.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Lignes affichees</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{filteredLines.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Total debit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(totalDebit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Total credit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(totalCredit)}</p>
          </CardContent>
        </Card>
      </div>

      {!balanced && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Journal non equilibre</p>
            <p className="text-sm">
              Le filtre courant affiche un total debit different du total credit.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher par facture, cheque, utilisateur, compte..."
            className="pl-9"
          />
        </div>
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <select
          value={journalType}
          onChange={(event) =>
            setJournalType(event.target.value as "all" | AccountingJournalType)
          }
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
        >
          <option value="all">Type de journal</option>
          {Object.entries(accountingJournalTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
        >
          <option value="all">Compte comptable</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} - {account.name}
            </option>
          ))}
        </select>
        <select
          value={sourceType}
          onChange={(event) =>
            setSourceType(event.target.value as "all" | AccountingSourceType)
          }
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
        >
          <option value="all">Source</option>
          {Object.entries(accountingSourceTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={userFilter}
          onChange={(event) => setUserFilter(event.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none lg:col-span-2"
        >
          <option value="all">Utilisateur</option>
          {users.map((user) => (
            <option key={user} value={user}>
              {user}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <div className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N° operation</TableHead>
                <TableHead>Date operation</TableHead>
                <TableHead>N° compte</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>N° facture</TableHead>
                <TableHead>N° cheque</TableHead>
                <TableHead>Divers / Nom</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">{line.operationNumber}</TableCell>
                  <TableCell>{formatDate(line.date)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{line.accountCode}</span>
                      <span className="text-xs text-muted-foreground">{line.accountName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{line.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.description}
                        {line.reference ? ` • REF ${line.reference}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {accountingJournalTypeLabels[line.journalType]}
                        </Badge>
                        {line.sourceType && (
                          <Badge variant="secondary">
                            {accountingSourceTypeLabels[line.sourceType]}
                          </Badge>
                        )}
                        {line.createdByUserName && (
                          <Badge variant="outline">{line.createdByUserName}</Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.debit > 0 ? formatCurrency(line.debit) : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.credit > 0 ? formatCurrency(line.credit) : "-"}
                  </TableCell>
                  <TableCell>{line.invoiceNumber ?? line.reference ?? "-"}</TableCell>
                  <TableCell>{line.checkNumber ?? "-"}</TableCell>
                  <TableCell>{line.partyName ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="text-right font-semibold">
                  Totaux
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatCurrency(totalDebit)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatCurrency(totalCredit)}
                </TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </div>
    </div>
  );
}
