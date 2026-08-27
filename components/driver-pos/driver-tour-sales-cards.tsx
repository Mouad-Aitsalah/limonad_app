import type * as React from "react";
import Link from "next/link";
import { CalendarDays, Eye, PackageSearch, Route, Truck, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { DriverTourSalesGroup } from "@/lib/driver-sales-calculations";

type DriverTourSalesCardsProps = {
  groups: DriverTourSalesGroup[];
  onSelectTour: (group: DriverTourSalesGroup) => void;
};

export function DriverTourSalesCards({
  groups,
  onSelectTour,
}: DriverTourSalesCardsProps) {
  if (groups.length === 0) {
    return (
      <Card className="border-dashed border-border/80 bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-muted-foreground">
            <PackageSearch aria-hidden="true" className="h-6 w-6" />
          </div>
          <div>
            <p className="font-medium text-foreground">Aucune vente trouvee</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Les ventes creees depuis le POS chauffeur apparaitront ici
              automatiquement.
            </p>
          </div>
          <Button render={<Link href="/driver/pos" />}>
            Acceder au point de vente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {groups.map((group) => {
        const { summary } = group;
        return (
          <Card
            key={summary.tourId}
            className="border-border/70 shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
          >
            <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg">{summary.tourCode}</CardTitle>
                  <Badge
                    variant="outline"
                    className={
                      summary.status === "ACTIVE"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }
                  >
                    {summary.status === "ACTIVE" ? "Active" : "Cloturee"}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays aria-hidden="true" className="h-4 w-4" />
                    {new Date(summary.date).toLocaleDateString("fr-FR")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Truck aria-hidden="true" className="h-4 w-4" />
                    {summary.truckCode}
                  </span>
                </div>
              </div>
              <Button variant="outline" onClick={() => onSelectTour(group)}>
                <Eye aria-hidden="true" />
                Voir les ventes
              </Button>
            </CardHeader>

            <CardContent>
              <div className="grid gap-3 sm:grid-cols-4">
                <Metric
                  label="CA TTC"
                  value={formatCurrency(summary.totalTTC)}
                  highlight
                />
                <Metric label="Factures" value={summary.salesCount.toString()} />
                <Metric label="Articles" value={summary.totalQuantity.toString()} />
                <Metric
                  label="Clients"
                  value={summary.customersCount.toString()}
                  icon={<Users aria-hidden="true" className="h-3.5 w-3.5" />}
                />
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                <Route aria-hidden="true" className="h-4 w-4 text-emerald-600" />
                Depart {summary.departureAt.toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {summary.returnAt
                  ? ` - Retour ${summary.returnAt.toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : " - Tournee en cours"}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className={`mt-1 font-semibold tabular-nums ${
          highlight ? "text-emerald-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
