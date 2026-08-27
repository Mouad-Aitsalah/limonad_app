"use client";

import * as React from "react";
import { toast } from "sonner";

import { AppPageHeader } from "@/components/ui/app-page-header";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { TruckDialog } from "@/components/trucks/truck-dialog";
import { TrucksToolbar } from "@/components/trucks/trucks-toolbar";
import { TrucksTable } from "@/components/trucks/trucks-table";
import type { DepotDto, TruckDto, TruckMutationInput } from "@/types/operations-dto";

type TrucksViewProps = {
  initialTrucks: TruckDto[];
  depots: DepotDto[];
};

export function TrucksView({ initialTrucks, depots }: TrucksViewProps) {
  const [trucks, setTrucks] = React.useState(initialTrucks);
  const [search, setSearch] = React.useState("");
  const [statut, setStatut] = React.useState("all");
  const [editingTruck, setEditingTruck] = React.useState<TruckDto | null>(null);
  const [viewingTruck, setViewingTruck] = React.useState<TruckDto | null>(null);

  const filteredTrucks = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    return trucks.filter((truck) => {
      const matchesSearch =
        query.length === 0 ||
        truck.code.toLowerCase().includes(query) ||
        truck.registration.toLowerCase().includes(query) ||
        (truck.brand?.toLowerCase().includes(query) ?? false) ||
        (truck.model?.toLowerCase().includes(query) ?? false);
      const matchesStatut = statut === "all" || truck.status === statut;
      return matchesSearch && matchesStatut;
    });
  }, [trucks, search, statut]);

  async function saveTruck(
    values: TruckMutationInput,
    truckId?: string,
  ): Promise<Record<string, string> | null> {
    const response = await fetch(truckId ? `/api/trucks/${truckId}` : "/api/trucks", {
      method: truckId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = (await response.json()) as {
      truck?: TruckDto;
      message?: string;
      fieldErrors?: Record<string, string>;
    };

    if (!response.ok || !payload.truck) {
      toast.error(payload.message ?? "Impossible d'enregistrer le camion.");
      return payload.fieldErrors ?? { form: payload.message ?? "Erreur inconnue." };
    }

    const savedTruck = payload.truck;
    setTrucks((current) =>
      truckId
        ? current.map((truck) => (truck.id === savedTruck.id ? savedTruck : truck))
        : [savedTruck, ...current],
    );
    toast.success(truckId ? "Camion modifie." : "Camion cree.");
    setEditingTruck(null);
    return null;
  }

  async function toggleStatus(truck: TruckDto) {
    const active = truck.status === "INACTIVE";
    const response = await fetch(`/api/trucks/${truck.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const payload = (await response.json()) as { truck?: TruckDto; message?: string };
    if (!response.ok || !payload.truck) {
      toast.error(payload.message ?? "Impossible de modifier le statut.");
      return;
    }
    const updatedTruck = payload.truck;
    setTrucks((current) =>
      current.map((item) => (item.id === updatedTruck.id ? updatedTruck : item)),
    );
    toast.success(active ? "Camion active." : "Camion desactive.");
  }

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Logistique"
        title="Camions"
        description="Suivez la flotte COMDIS, les affectations, les statuts et la disponibilite des camions."
        actions={<TruckDialog depots={depots} onSave={saveTruck} />}
      />

      <DataTableShell
        title="Flotte de livraison"
        description="Recherchez un camion, consultez ses informations et pilotez son statut."
        countLabel={`${filteredTrucks.length} camion${filteredTrucks.length > 1 ? "s" : ""}`}
        toolbar={
          <TrucksToolbar
            search={search}
            onSearchChange={setSearch}
            statut={statut}
            onStatutChange={setStatut}
          />
        }
      >
        <TrucksTable
          trucks={filteredTrucks}
          onView={setViewingTruck}
          onEdit={setEditingTruck}
          onToggleStatus={toggleStatus}
        />
      </DataTableShell>

      <TruckDialog
        truck={editingTruck}
        depots={depots}
        open={editingTruck !== null}
        onOpenChange={(open) => {
          if (!open) setEditingTruck(null);
        }}
        onSave={saveTruck}
      />
      <TruckDialog
        truck={viewingTruck}
        mode="view"
        depots={depots}
        open={viewingTruck !== null}
        onOpenChange={(open) => {
          if (!open) setViewingTruck(null);
        }}
        onSave={saveTruck}
      />
    </div>
  );
}
