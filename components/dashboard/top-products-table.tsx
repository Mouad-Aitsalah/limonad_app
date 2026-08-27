import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DashboardTopProduct } from "@/lib/server/dashboard";
import { DataTableShell } from "@/components/ui/data-table-shell";

export function TopProductsTable({ rows }: { rows: DashboardTopProduct[] }) {
  return (
    <DataTableShell
      title="Meilleurs produits"
      description="Classes par unites vendues sur les 30 derniers jours."
      countLabel={`${rows.length.toLocaleString("fr-FR")} produit${rows.length > 1 ? "s" : ""} dans le top courant`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produit</TableHead>
            <TableHead>Categorie</TableHead>
            <TableHead className="text-right">Unites vendues</TableHead>
            <TableHead className="text-right">Chiffre d&apos;affaires</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((product) => (
            <TableRow key={product.id}>
              <TableCell className="font-medium text-foreground">{product.name}</TableCell>
              <TableCell className="text-muted-foreground">{product.category}</TableCell>
              <TableCell className="text-right">
                {product.unitsSold.toLocaleString("fr-FR")}
              </TableCell>
              <TableCell className="text-right font-semibold">{product.revenue}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
