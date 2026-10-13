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
import { useColumnLabels } from "@/components/table-labels/table-labels-provider";
import { useTableColumns } from "@/components/table-columns/table-columns-provider";
import type { TableColumnKey } from "@/lib/table-labels/registry";

type SessionColumn = TableColumnKey<"archiveSessions">;

const RIGHT_ALIGNED: ReadonlySet<SessionColumn> = new Set(["orders", "sales", "refunds", "net", "actions"]);

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
  const label = useColumnLabels("archiveSessions");
  // Columns in the order chosen by the admin ("Personnaliser les colonnes"); default = the original ones.
  const { columns } = useTableColumns("salesArchive", "archiveSessions");
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

  function cell(column: SessionColumn, session: PosSessionDto) {
    switch (column) {
      case "session":
        return (
          <TableCell key={column} className="font-medium text-foreground">
            {session.displayNumber}
          </TableCell>
        );
      case "opened":
        return (
          <TableCell key={column} className="text-muted-foreground">
            {formatDateTime(session.openedAt)}
          </TableCell>
        );
      case "closed":
        return (
          <TableCell key={column} className="text-muted-foreground">
            {formatDateTime(session.closedAt)}
          </TableCell>
        );
      case "orders":
        return <TableCell key={column} className="text-right tabular-nums">{session.ordersCount}</TableCell>;
      case "sales":
        return (
          <TableCell key={column} className="text-right tabular-nums">
            {formatCurrency(session.totalSales)}
          </TableCell>
        );
      case "refunds":
        return (
          <TableCell key={column} className="text-right tabular-nums text-red-600">
            {session.totalRefunds > 0
              ? `− ${formatCurrency(session.totalRefunds)}`
              : formatCurrency(0)}
          </TableCell>
        );
      case "net":
        return (
          <TableCell key={column} className="text-right font-medium tabular-nums">
            {formatCurrency(session.totalNet)}
          </TableCell>
        );
      case "status":
        return (
          <TableCell key={column}>
            <SessionStatusBadge status={session.status} />
          </TableCell>
        );
      case "actions":
        return (
          <TableCell key={column} className="text-right">
            <Button type="button" variant="outline" size="sm" onClick={() => onViewOrders(session)}>
              <Eye aria-hidden="true" className="h-4 w-4" />
              Voir commandes
            </Button>
          </TableCell>
        );
      default:
        return null;
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column} className={RIGHT_ALIGNED.has(column) ? "text-right" : undefined}>
              {label(column)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>{columns.map((column) => cell(column, session))}</TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
