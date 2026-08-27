"use client";

import * as React from "react";
import { Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { CashDepositContextDto, CashDepositSummaryDto } from "@/types/cash-deposits";
import type { DepotDto } from "@/types/operations-dto";

type DepositHistoryTableProps = {
  deposits: CashDepositSummaryDto[];
  depots: DepotDto[];
  context: CashDepositContextDto;
  onOpenDetail: (id: string) => void;
};

const statusLabels: Record<string, string> = {
  VALIDATED: "Valide",
  CANCELLED: "Annule",
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function DepositHistoryTable({
  deposits,
  depots,
  context,
  onOpenDetail,
}: DepositHistoryTableProps) {
  const [search, setSearch] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [depotId, setDepotId] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [status, setStatus] = React.useState("");

  const users = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const deposit of deposits) {
      if (!seen.has(deposit.createdByUserId)) {
        seen.set(deposit.createdByUserId, deposit.createdByUserName);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [deposits]);

  const filtered = React.useMemo(() => {
    const query = normalizeSearch(search);
    return deposits.filter((deposit) => {
      if (query && !normalizeSearch(deposit.number).includes(query)) return false;
      const dateOnly = deposit.date.slice(0, 10);
      if (dateFrom && dateOnly < dateFrom) return false;
      if (dateTo && dateOnly > dateTo) return false;
      if (depotId && deposit.depotId !== depotId) return false;
      if (userId && deposit.createdByUserId !== userId) return false;
      if (status && deposit.status !== status) return false;
      return true;
    });
  }, [deposits, search, dateFrom, dateTo, depotId, userId, status]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">N° versement</Label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="VER-..."
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Date du</Label>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Date au</Label>
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Statut</Label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-3 focus:ring-emerald-500/15"
          >
            <option value="">Tous</option>
            <option value="VALIDATED">Valide</option>
            <option value="CANCELLED">Annule</option>
          </select>
        </div>
        {context.canFilterByDepot && depots.length > 1 ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">POS / Caisse</Label>
            <select
              value={depotId}
              onChange={(event) => setDepotId(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-3 focus:ring-emerald-500/15"
            >
              <option value="">Tous</option>
              {depots.map((depot) => (
                <option key={depot.id} value={depot.id}>
                  {depot.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {users.length > 1 ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Caissier</Label>
            <select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-3 focus:ring-emerald-500/15"
            >
              <option value="">Tous</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} versement{filtered.length > 1 ? "s" : ""}.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N° versement</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Heure</TableHead>
              <TableHead>POS / Caisse</TableHead>
              <TableHead>Caissier</TableHead>
              <TableHead className="text-right">Total especes</TableHead>
              <TableHead className="text-right">Cheques</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  Aucun versement ne correspond a la recherche.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((deposit) => (
                <TableRow key={deposit.id}>
                  <TableCell className="font-medium text-foreground">{deposit.number}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(deposit.date).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(deposit.createdAt).toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>{deposit.depotName}</TableCell>
                  <TableCell>{deposit.createdByUserName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(deposit.cashTotal)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(deposit.checkTotal)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(deposit.total)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={deposit.status === "VALIDATED" ? "secondary" : "destructive"}>
                      {statusLabels[deposit.status] ?? deposit.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenDetail(deposit.id)}
                    >
                      <Eye className="h-4 w-4" />
                      Voir
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
