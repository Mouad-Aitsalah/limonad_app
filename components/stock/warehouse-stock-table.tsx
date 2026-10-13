import { PackageSearch } from "lucide-react";

import { StockMobileList } from "@/components/stock/stock-mobile-list";
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
import { useColumnLabels } from "@/components/table-labels/table-labels-provider";
import { useTableColumns } from "@/components/table-columns/table-columns-provider";
import type { TableColumnKey } from "@/lib/table-labels/registry";

export function WarehouseStockTable({
  rows,
  showLocation = false,
}: {
  rows: StockLevelDto[];
  /** Phones only: add the location code under the reference (all-locations tab). */
  showLocation?: boolean;
}) {
  const label = useColumnLabels("warehouseStock");
  // Desktop table columns, in the order chosen by the admin; default = the original ones.
  const { columns } = useTableColumns("stock", "warehouseStock");
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
    <>
    {/* Phones / tablets: stock cards. From lg the table below is untouched. */}
    <div className="lg:hidden">
      <StockMobileList
        items={rows.map((row) => ({
          id: row.id,
          name: row.productName,
          reference: row.productReference,
          location: showLocation ? row.locationCode : undefined,
          quantity: row.quantity,
          value: row.stockValue,
          tone: getStockStatus(row.status).tone,
        }))}
      />
    </div>
    <div className="max-lg:hidden">
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
        {rows.map((row) => {
          const status = getStockStatus(row.status);

          return (
            <TableRow key={row.id}>
              {columns.map((column) => warehouseStockCell(column, row, status))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>
    </>
  );
}

type WarehouseStockColumn = TableColumnKey<"warehouseStock">;

const RIGHT_ALIGNED: ReadonlySet<WarehouseStockColumn> = new Set(["currentStock", "minimumStock", "value"]);

/** One desktop cell per column, same content and classes as before. */
function warehouseStockCell(
  column: WarehouseStockColumn,
  row: StockLevelDto,
  status: ReturnType<typeof getStockStatus>,
) {
  switch (column) {
    case "product":
      return (
        <TableCell key={column}>
          <div className="font-medium text-foreground">
            {row.productName}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.productReference}
          </div>
        </TableCell>
      );
    case "category":
      return (
        <TableCell key={column} className="text-muted-foreground">
          {row.categoryName}
        </TableCell>
      );
    case "currentStock":
      return (
        <TableCell
          key={column}
          className={cn(
            "text-right font-medium tabular-nums",
            status.tone === "danger" && "text-red-600",
            status.tone === "warning" && "text-amber-600",
          )}
        >
          {row.quantity}
        </TableCell>
      );
    case "minimumStock":
      return (
        <TableCell key={column} className="text-right text-muted-foreground tabular-nums">
          {row.minimumStock}
        </TableCell>
      );
    case "value":
      return (
        <TableCell key={column} className="text-right font-medium tabular-nums">
          {formatCurrency(row.stockValue)}
        </TableCell>
      );
    case "status":
      return (
        <TableCell key={column}>
          <Badge className={status.className} variant="outline">
            {status.label}
          </Badge>
        </TableCell>
      );
    default:
      return null;
  }
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
