import { PackageSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { StockLevelDto } from "@/types/operations-dto";

export function WarehouseStockTable({ rows }: { rows: StockLevelDto[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <PackageSearch
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun produit ne correspond aux filtres de stock.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Produit</TableHead>
          <TableHead>Categorie</TableHead>
          <TableHead>Emplacement</TableHead>
          <TableHead className="text-right">Stock actuel</TableHead>
          <TableHead className="text-right">Reserve</TableHead>
          <TableHead className="text-right">Disponible</TableHead>
          <TableHead className="text-right">Stock minimum</TableHead>
          <TableHead className="text-right">Valeur</TableHead>
          <TableHead>Statut</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const status = getStockStatus(row.status);

          return (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium text-foreground">
                  {row.productName}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.productReference}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.categoryName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.locationCode}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-medium tabular-nums",
                  status.tone === "danger" && "text-red-600",
                  status.tone === "warning" && "text-amber-600",
                )}
              >
                {row.quantity}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.reservedQuantity}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {row.availableQuantity}
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {row.minimumStock}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatCurrency(row.stockValue)}
              </TableCell>
              <TableCell>
                <Badge className={status.className} variant="outline">
                  {status.label}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function getStockStatus(status: StockLevelDto["status"]) {
  if (status === "OUT_OF_STOCK") {
    return {
      label: "Rupture",
      tone: "danger",
      className: "border-red-200 bg-red-50 text-red-700",
    } as const;
  }
  if (status === "LOW_STOCK") {
    return {
      label: "Sous seuil",
      tone: "warning",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    } as const;
  }
  return {
    label: "Disponible",
    tone: "success",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  } as const;
}
