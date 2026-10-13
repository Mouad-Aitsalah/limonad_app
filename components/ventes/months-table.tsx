import { ChevronRight, TableProperties } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { SalesMonthDto } from "@/types/operations-dto";
import { useColumnLabels } from "@/components/table-labels/table-labels-provider";
import { useTableColumns } from "@/components/table-columns/table-columns-provider";
import type { TableColumnKey } from "@/lib/table-labels/registry";

type MonthColumn = TableColumnKey<"archiveMonths">;

type MonthsTableProps = {
  months: SalesMonthDto[];
  onSelectMonth: (month: SalesMonthDto) => void;
};

export function MonthsTable({ months, onSelectMonth }: MonthsTableProps) {
  const label = useColumnLabels("archiveMonths");
  // Columns in the order chosen by the admin ("Personnaliser les colonnes"); default = the original ones.
  const { columns } = useTableColumns("salesArchive", "archiveMonths");
  if (months.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <TableProperties aria-hidden="true" className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Aucune donnée pour le moment.</p>
      </div>
    );
  }

  function cell(column: MonthColumn, month: SalesMonthDto) {
    switch (column) {
      case "month":
        return <TableCell key={column} className="font-medium text-foreground">{month.label}</TableCell>;
      case "year":
        return <TableCell key={column} className="text-right tabular-nums">{month.year}</TableCell>;
      case "orders":
        return <TableCell key={column} className="text-right tabular-nums">{month.ordersCount}</TableCell>;
      case "sold":
        return (
          <TableCell key={column} className="text-right font-medium tabular-nums">
            {formatCurrency(month.totalSales)}
          </TableCell>
        );
      case "refunds":
        return (
          <TableCell key={column} className="text-right tabular-nums text-red-600">
            {month.totalRefunds > 0
              ? `− ${formatCurrency(month.totalRefunds)}`
              : formatCurrency(0)}
          </TableCell>
        );
      case "net":
        return (
          <TableCell key={column} className="text-right font-medium tabular-nums text-emerald-700">
            {formatCurrency(month.totalNet)}
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
            <TableHead key={column} className={column === "month" ? undefined : "text-right"}>
              {label(column)}
            </TableHead>
          ))}
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {months.map((month) => (
          <TableRow
            key={month.key}
            className="cursor-pointer"
            onClick={() => onSelectMonth(month)}
          >
            {columns.map((column) => cell(column, month))}
            <TableCell>
              <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
