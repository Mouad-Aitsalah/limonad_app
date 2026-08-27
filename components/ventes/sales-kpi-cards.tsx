import { RotateCcw, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { GlobalSalesTotals } from "@/lib/sales-calculations";

type KpiDef = {
  label: string;
  value: string;
  icon: LucideIcon;
};

export function SalesKpiCards({ totals }: { totals: GlobalSalesTotals }) {
  const kpis: KpiDef[] = [
    {
      label: "Nombre de commandes",
      value: totals.nombreCommandes.toLocaleString("fr-FR"),
      icon: ShoppingCart,
    },
    {
      label: "CA Total",
      value: formatCurrency(totals.caTotal),
      icon: Wallet,
    },
    {
      label: "Remboursements",
      value: formatCurrency(totals.remboursements),
      icon: RotateCcw,
    },
    {
      label: "Bénéfice",
      value: formatCurrency(totals.benefice),
      icon: TrendingUp,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <Card
          key={kpi.label}
          className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
        >
          <CardContent className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                {kpi.label}
              </p>
              <p className="font-heading text-2xl font-semibold text-foreground">
                {kpi.value}
              </p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <kpi.icon aria-hidden="true" className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
