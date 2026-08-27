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

type MonthsTableProps = {
  months: SalesMonthDto[];
  onSelectMonth: (month: SalesMonthDto) => void;
};

export function MonthsTable({ months, onSelectMonth }: MonthsTableProps) {
  if (months.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <TableProperties aria-hidden="true" className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Aucune donnée pour le moment.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mois</TableHead>
          <TableHead className="text-right">Année</TableHead>
          <TableHead className="text-right">Commandes</TableHead>
          <TableHead className="text-right">Total vendu</TableHead>
          <TableHead className="text-right">Remboursements</TableHead>
          <TableHead className="text-right">Total net</TableHead>
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
            <TableCell className="font-medium text-foreground">{month.label}</TableCell>
            <TableCell className="text-right tabular-nums">{month.year}</TableCell>
            <TableCell className="text-right tabular-nums">{month.ordersCount}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCurrency(month.totalSales)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-red-600">
              {month.totalRefunds > 0
                ? `− ${formatCurrency(month.totalRefunds)}`
                : formatCurrency(0)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums text-emerald-700">
              {formatCurrency(month.totalNet)}
            </TableCell>
            <TableCell>
              <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
