import { Ban, CheckCircle2, UserPlus, Users } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { Customer } from "@/types/customer";

type DriverClientsKpiCardsProps = {
  customers: Customer[];
  driverId: string;
};

export function DriverClientsKpiCards({
  customers,
  driverId,
}: DriverClientsKpiCardsProps) {
  const cards = [
    {
      label: "Nombre total de clients",
      value: customers.length,
      icon: Users,
    },
    {
      label: "Clients actifs",
      value: customers.filter((customer) => customer.statut === "actif").length,
      icon: CheckCircle2,
    },
    {
      label: "Clients bloques",
      value: customers.filter((customer) => customer.statut === "bloque").length,
      icon: Ban,
    },
    {
      label: "Ajoutes par vous",
      value: customers.filter((customer) => customer.createdByDriverId === driverId)
        .length,
      icon: UserPlus,
    },
  ] as const;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card
            key={card.label}
            className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
          >
            <CardContent className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </p>
                <p className="font-heading text-2xl font-semibold text-foreground">
                  {card.value.toLocaleString("fr-FR")}
                </p>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
