import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Kpi } from "@/lib/mock-data/dashboard";

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  const TrendIcon = kpi.trend === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            {kpi.label}
          </p>
          <p className="font-heading text-2xl font-semibold text-foreground">
            {kpi.value}
          </p>
          <div
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium",
              kpi.trend === "up" ? "text-emerald-600" : "text-red-500",
            )}
          >
            <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {kpi.change}% vs mois dernier
          </div>
        </div>

        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
