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
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label("date")}</TableHead>
          <TableHead>{label("number")}</TableHead>
          <TableHead>{label("product")}</TableHead>
          <TableHead>{label("location")}</TableHead>
          <TableHead className="text-right">{label("before")}</TableHead>
          <TableHead className="text-right">{label("after")}</TableHead>
          <TableHead className="text-right">{label("difference")}</TableHead>
          <TableHead>{label("reason")}</TableHead>
          <TableHead>{label("origin")}</TableHead>
          <TableHead>{label("destination")}</TableHead>
          <TableHead>{label("user")}</TableHead>
          <TableHead>{label("type")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {movements.map((movement) => (
          <TableRow key={movement.id}>
            <TableCell className="text-muted-foreground">
              {new Date(movement.createdAt).toLocaleDateString("fr-FR")}
            </TableCell>
            <TableCell className="font-medium text-foreground">
              {movement.movementNumber}
            </TableCell>
            <TableCell className="font-medium text-foreground">
              {movement.productName}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {movement.locationCode ??
                movement.destinationLocationName ??
                movement.sourceLocationName ??
                "-"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {movement.beforeQuantity ?? "-"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {movement.afterQuantity ?? "-"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatDelta(movement)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {movement.reason ?? movement.note ?? "-"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {movement.sourceLocationName ?? "Externe"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {movement.destinationLocationName ?? "Externe"}
            </TableCell>
            <TableCell>{movement.createdByUserName}</TableCell>
            <TableCell>{movementLabels[movement.type] ?? movement.type}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatDelta(movement: StockMovementDto) {
  const delta = movement.deltaQuantity;
  if (delta === null || delta === undefined) {
    return movement.quantity;
  }

  return `${delta > 0 ? "+" : ""}${delta}`;
}
