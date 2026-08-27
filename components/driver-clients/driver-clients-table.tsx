import { Edit, PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { customerTypeLabels } from "@/lib/customer-utils";
import { formatCurrency } from "@/lib/utils";
import { CustomerStatusBadge } from "@/components/driver-clients/customer-status-badge";
import type { Customer } from "@/types/customer";

type DriverClientsTableProps = {
  customers: Customer[];
  driverId: string;
  onEdit: (customer: Customer) => void;
};

export function DriverClientsTable({
  customers,
  driverId,
  onEdit,
}: DriverClientsTableProps) {
  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <PackageSearch
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun client ne correspond a ces criteres.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nom ou raison sociale</TableHead>
          <TableHead>Code client</TableHead>
          <TableHead>Telephone</TableHead>
          <TableHead>Adresse</TableHead>
          <TableHead>Ville</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Credit utilise</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => {
          const canEdit = customer.createdByDriverId === driverId;

          return (
            <TableRow key={customer.id}>
              <TableCell className="font-medium text-foreground">
                {customer.nom}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {customer.code}
              </TableCell>
              <TableCell>{customer.telephone}</TableCell>
              <TableCell className="max-w-[220px] truncate text-muted-foreground">
                {customer.adresse}
              </TableCell>
              <TableCell>{customer.ville}</TableCell>
              <TableCell>{customerTypeLabels[customer.type]}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(customer.creditUtilise)}
              </TableCell>
              <TableCell>
                <CustomerStatusBadge status={customer.statut} />
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!canEdit}
                    aria-label={`Modifier ${customer.nom}`}
                    onClick={() => onEdit(customer)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
