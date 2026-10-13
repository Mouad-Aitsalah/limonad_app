import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StockMovementDto } from "@/types/operations-dto";
import { useColumnLabels } from "@/components/table-labels/table-labels-provider";
import { useTableColumns } from "@/components/table-columns/table-columns-provider";
import type { TableColumnKey } from "@/lib/table-labels/registry";

type MovementColumn = TableColumnKey<"stockMovements">;

const RIGHT_ALIGNED: ReadonlySet<MovementColumn> = new Set(["before", "after", "difference"]);

const movementLabels: Record<string, string> = {
  PURCHASE_ENTRY: "Reception achat",
  COUNTER_SALE: "Vente comptoir",
  TRUCK_LOADING: "Chargement camion",
  TRUCK_SALE: "Vente camion",
  TOUR_RETURN: "Retour tournee",
  CUSTOMER_RETURN: "Retour client",
  INVENTORY_ADJUSTMENT: "Ajustement",
  BREAKAGE: "Casse",
  LOSS: "Perte",
  REVERSAL: "Contrepassation",
};

export function StockMovementsTable({
  movements,
}: {
  movements: StockMovementDto[];
}) {
  const label = useColumnLabels("stockMovements");
  // Columns in the order chosen by the admin; default = the original ones.
  const { columns } = useTableColumns("stock", "stockMovements");
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
        {movements.map((movement) => (
          <TableRow key={movement.id}>
            {columns.map((column) => movementCell(column, movement))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** One cell per column, same content and classes as before. */
function movementCell(column: MovementColumn, movement: StockMovementDto) {
  switch (column) {
    case "date":
      return (
        <TableCell key={column} className="text-muted-foreground">
          {new Date(movement.createdAt).toLocaleDateString("fr-FR")}
        </TableCell>
      );
    case "number":
      return (
        <TableCell key={column} className="font-medium text-foreground">
          {movement.movementNumber}
        </TableCell>
      );
    case "product":
      return (
        <TableCell key={column} className="font-medium text-foreground">
          {movement.productName}
        </TableCell>
      );
    case "location":
      return (
        <TableCell key={column} className="text-muted-foreground">
          {movement.locationCode ??
            movement.destinationLocationName ??
            movement.sourceLocationName ??
            "-"}
        </TableCell>
      );
    case "before":
      return (
        <TableCell key={column} className="text-right tabular-nums">
          {movement.beforeQuantity ?? "-"}
        </TableCell>
      );
    case "after":
      return (
        <TableCell key={column} className="text-right tabular-nums">
          {movement.afterQuantity ?? "-"}
        </TableCell>
      );
    case "difference":
      return (
        <TableCell key={column} className="text-right tabular-nums">
          {formatDelta(movement)}
        </TableCell>
      );
    case "reason":
      return (
        <TableCell key={column} className="text-muted-foreground">
          {movement.reason ?? movement.note ?? "-"}
        </TableCell>
      );
    case "origin":
      return (
        <TableCell key={column} className="text-muted-foreground">
          {movement.sourceLocationName ?? "Externe"}
        </TableCell>
      );
    case "destination":
      return (
        <TableCell key={column} className="text-muted-foreground">
          {movement.destinationLocationName ?? "Externe"}
        </TableCell>
      );
    case "user":
      return <TableCell key={column}>{movement.createdByUserName}</TableCell>;
    case "type":
      return <TableCell key={column}>{movementLabels[movement.type] ?? movement.type}</TableCell>;
    default:
      return null;
  }
}

function formatDelta(movement: StockMovementDto) {
  const delta = movement.deltaQuantity;
  if (delta === null || delta === undefined) {
    return movement.quantity;
  }

  return `${delta > 0 ? "+" : ""}${delta}`;
}
