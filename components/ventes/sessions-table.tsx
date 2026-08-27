import { CalendarX2, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SessionStatusBadge } from "@/components/ventes/session-status-badge";
import { formatCurrency } from "@/lib/utils";
import type { PosSessionDto } from "@/types/operations-dto";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SessionsTableProps = {
  sessions: PosSessionDto[];
  onViewOrders: (session: PosSessionDto) => void;
};

export function SessionsTable({ sessions, onViewOrders }: SessionsTableProps) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <CalendarX2 aria-hidden="true" className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Aucune session ne correspond à ces critères.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Session</TableHead>
          <TableHead>Ouverture</TableHead>
          <TableHead>Fermeture</TableHead>
          <TableHead className="text-right">Commandes</TableHead>
          <TableHead className="text-right">Total ventes</TableHead>
          <TableHead className="text-right">Remboursements</TableHead>
          <TableHead className="text-right">Total net</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>
            <TableCell className="font-medium text-foreground">
              {session.displayNumber}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDateTime(session.openedAt)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDateTime(session.closedAt)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{session.ordersCount}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCurrency(session.totalSales)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-red-600">
              {session.totalRefunds > 0
                ? `− ${formatCurrency(session.totalRefunds)}`
                : formatCurrency(0)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCurrency(session.totalNet)}
            </TableCell>
            <TableCell>
              <SessionStatusBadge status={session.status} />
            </TableCell>
            <TableCell className="text-right">
              <Button type="button" variant="outline" size="sm" onClick={() => onViewOrders(session)}>
                <Eye aria-hidden="true" className="h-4 w-4" />
                Voir commandes
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
