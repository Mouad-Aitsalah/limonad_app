import { Container } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { TruckStatusBadge } from "@/components/trucks/truck-status-badge";
import type { TruckDto } from "@/types/operations-dto";

export function DriverTruckCard({ truck }: { truck: TruckDto | null }) {
  if (!truck) {
    return (
      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Container aria-hidden="true" className="h-9 w-9 text-muted-foreground/40" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Aucun camion affecté</p>
            <p className="text-sm text-muted-foreground">Contactez l&apos;administrateur.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const brandModel = [truck.brand, truck.model].filter(Boolean).join(" ") || "—";

  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="page-eyebrow text-muted-foreground">Mon camion</p>
            <h2 className="mt-1 font-heading text-xl font-semibold text-foreground">
              {truck.code}
            </h2>
          </div>
          <TruckStatusBadge status={truck.status} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Immatriculation</p>
            <p className="text-sm font-medium text-foreground tabular-nums">
              {truck.registration}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Marque / Modèle</p>
            <p className="text-sm font-medium text-foreground">{brandModel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Capacité</p>
            <p className="text-sm font-medium text-foreground tabular-nums">
              {truck.capacity ? `${truck.capacity.toLocaleString("fr-FR")} kg` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dépôt de rattachement</p>
            <p className="text-sm font-medium text-foreground">{truck.depot.name}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
