"use client";

import * as React from "react";
import { Warehouse } from "lucide-react";
import { toast } from "sonner";

import { DepotCreateDialog } from "@/components/depots/depot-create-dialog";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { Badge } from "@/components/ui/badge";
import { DataTableShell } from "@/components/ui/data-table-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DepotCreateInput, DepotDto } from "@/types/operations-dto";

type DepotsViewProps = {
  initialDepots: DepotDto[];
};

export function DepotsView({ initialDepots }: DepotsViewProps) {
  const [depots, setDepots] = React.useState(initialDepots);

  async function createDepot(
    values: DepotCreateInput,
  ): Promise<Record<string, string> | null> {
    const response = await fetch("/api/depots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = (await response.json()) as {
      depot?: DepotDto;
      message?: string;
      fieldErrors?: Record<string, string>;
    };

    if (!response.ok || !payload.depot) {
      toast.error(payload.message ?? "Impossible de créer le dépôt.");
      return payload.fieldErrors ?? { form: payload.message ?? "Erreur inconnue." };
    }

    const created = payload.depot;
    setDepots((current) =>
      [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    toast.success(`Dépôt ${created.name} créé avec succès.`);
    return null;
  }

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Structure"
        title="Dépôts"
        description="Chaque organisation gère ici ses dépôts. Un dépôt et son emplacement de stock sont nécessaires au point de vente et aux versements."
        actions={<DepotCreateDialog onCreate={createDepot} />}
      />

      <DataTableShell
        title="Dépôts de l'organisation"
        description="Nom, statut et emplacement de stock associé."
        countLabel={`${depots.length} dépôt${depots.length > 1 ? "s" : ""}`}
      >
        {depots.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Warehouse
              aria-hidden="true"
              className="h-10 w-10 text-muted-foreground/40"
            />
            <p className="text-sm text-muted-foreground">
              Aucun dépôt. Créez-en un pour activer le point de vente et les
              versements.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Emplacement de stock associé</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {depots.map((depot) => (
                <TableRow key={depot.id}>
                  <TableCell className="font-medium text-foreground">
                    {depot.code}
                  </TableCell>
                  <TableCell className="text-foreground">{depot.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        depot.active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }
                    >
                      {depot.active ? "Actif" : "Inactif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {depot.stockLocationName ? (
                      <span className="text-foreground">
                        {depot.stockLocationName}
                        {depot.stockLocationActive === false ? " (inactif)" : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableShell>
    </div>
  );
}
