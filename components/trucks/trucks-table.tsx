import { Eye, Pencil, PowerOff, TruckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TruckStatusBadge } from "@/components/trucks/truck-status-badge";
import type { TruckDto } from "@/types/operations-dto";

type TrucksTableProps = {
  trucks: TruckDto[];
  onView: (truck: TruckDto) => void;
  onEdit: (truck: TruckDto) => void;
  onToggleStatus: (truck: TruckDto) => void;
};

export function TrucksTable({
  trucks,
  onView,
  onEdit,
  onToggleStatus,
}: TrucksTableProps) {
  if (trucks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <TruckIcon
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun camion ne correspond a ces criteres.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Immatriculation</TableHead>
          <TableHead>Marque</TableHead>
          <TableHead>Modele</TableHead>
          <TableHead>Depot</TableHead>
          <TableHead>Emplacement</TableHead>
          <TableHead className="text-right">Capacite</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trucks.map((truck) => (
          <TableRow key={truck.id}>
            <TableCell className="font-medium text-foreground">
              {truck.code}
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              {truck.registration}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {truck.brand ?? "-"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {truck.model ?? "-"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {truck.depot.name}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {truck.stockLocation?.code ?? "-"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {truck.capacity?.toLocaleString("fr-FR") ?? "-"}
            </TableCell>
            <TableCell>
              <TruckStatusBadge status={truck.status} />
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Voir le camion"
                  onClick={() => onView(truck)}
                >
                  <Eye aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Modifier le camion"
                  onClick={() => onEdit(truck)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant={truck.status === "INACTIVE" ? "outline" : "destructive"}
                  size="icon-sm"
                  aria-label="Changer le statut du camion"
                  onClick={() => onToggleStatus(truck)}
                >
                  <PowerOff aria-hidden="true" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
