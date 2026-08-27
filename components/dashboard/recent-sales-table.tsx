import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DashboardRecentSale } from "@/lib/server/dashboard";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { StatusBadge } from "@/components/ui/status-badge";

const statusLabels: Record<DashboardRecentSale["status"], string> = {
  PAID: "Paye",
  PARTIALLY_PAID: "Partiellement paye",
  CREDIT: "Credit",
  VALIDATED: "Valide",
  CANCELLED: "Annulee",
};

export function RecentSalesTable({ rows }: { rows: DashboardRecentSale[] }) {
  return (
    <DataTableShell
      title="Dernieres ventes"
      description="Transactions les plus recentes visibles dans COMDIS."
      countLabel={`${rows.length.toLocaleString("fr-FR")} vente${rows.length > 1 ? "s" : ""} recentes`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reference</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead className="text-right">Statut</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((sale) => (
            <TableRow key={sale.id}>
              <TableCell className="font-medium text-foreground">{sale.id}</TableCell>
              <TableCell className="text-muted-foreground">{sale.client}</TableCell>
              <TableCell className="text-muted-foreground">{sale.date}</TableCell>
              <TableCell className="text-right font-semibold">{sale.amount}</TableCell>
              <TableCell className="text-right">
                <StatusBadge value={sale.status} label={statusLabels[sale.status]} className="ml-auto" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
