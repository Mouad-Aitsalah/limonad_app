import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DirectionKpi } from "@/types/dashboard-direction";

/**
 * Dense KPI card for the Direction dashboard - deliberately a separate
 * component from components/ui/metric-card.tsx (used across the rest of
 * the app) rather than a shared-component edit, so this dashboard can stay
 * compact (Card size="sm") without changing the look of every other page
 * that already relies on MetricCard's taller layout.
 */
export function DirectionKpiCard({ kpi, emphasis = false }: { kpi: DirectionKpi; emphasis?: boolean }) {
  const TrendIcon =
    kpi.trend?.direction === "up" ? ArrowUpRight : kpi.trend?.direction === "down" ? ArrowDownRight : Minus;

  return (
    <Card size="sm" className="h-full">
      <CardContent className="flex h-full flex-col justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-[var(--text-secondary)] uppercase">{kpi.label}</p>
        <p
          className={cn(
            "font-heading leading-none font-bold tracking-[-0.03em] text-[var(--text-primary)]",
            emphasis ? "text-[1.6rem]" : "text-xl",
          )}
        >
          {kpi.value}
        </p>
        <div className="flex min-h-[1.25rem] items-center gap-2">
          {kpi.trend ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.72rem] font-semibold",
                kpi.trend.direction === "up"
                  ? "bg-emerald-50 text-emerald-700"
                  : kpi.trend.direction === "down"
                    ? "bg-rose-50 text-rose-700"
                    : "bg-slate-100 text-slate-700",
              )}
            >
              <TrendIcon className="h-3 w-3" aria-hidden="true" />
              {kpi.trend.value}
            </span>
          ) : null}
          {kpi.trend ? (
            <span className="truncate text-[0.72rem] text-muted-foreground">vs periode precedente</span>
          ) : null}
          {kpi.helper ? (
            <span className="truncate text-xs text-[var(--text-secondary)]">{kpi.helper}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
