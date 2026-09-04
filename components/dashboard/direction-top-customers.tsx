import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableShell } from "@/components/ui/data-table-shell";
import type { DirectionTopCustomerRow } from "@/types/dashboard-direction";

export function DirectionTopCustomersCard({ rows }: { rows: DirectionTopCustomerRow[] }) {
  return (
    <DataTableShell title="Clients" description="Top 5 clients par chiffre d'affaires sur la periode.">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Aucune vente client sur cette periode.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Ventes</TableHead>
              <TableHead className="text-right">CA TTC</TableHead>
              <TableHead className="text-right">Creance actuelle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.customerId}>
                <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                <TableCell className="text-right">{row.salesCount.toLocaleString("fr-FR")}</TableCell>
                <TableCell className="text-right font-semibold">{row.ca}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.receivable}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataTableShell>
  );
}
