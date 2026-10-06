import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { DirectionKpiValue } from "@/components/dashboard/direction-kpi-value";
import { kpiVisual, KPI_TONES } from "@/components/dashboard/direction-kpi-style";
import { cn } from "@/lib/utils";
import type { DirectionKpi } from "@/types/dashboard-direction";

/**
 * KPI card of the Direction dashboard - deliberately a separate component from
 * components/ui/metric-card.tsx (used across the rest of the app) rather than a
 * shared-component edit, so this dashboard has its own look without changing every
 * other page that relies on MetricCard.
 *
 * White card, very light shadow, a thin pastel accent line along the top and the
 * KPI's icon in a pastel circle at the top right (see direction-kpi-style.ts).
 *
 * Hierarchy: the figure dominates (large, bold, dark - see DirectionKpiValue), the
 * label comes second (small, grey), the trend / caption last (smallest, muted).
 * Display only: value, trend and caption are shown exactly as the server shaped them.
 */
export function DirectionKpiCard({ kpi, emphasis = false }: { kpi: DirectionKpi; emphasis?: boolean }) {
  const TrendIcon =
    kpi.trend?.direction === "up" ? ArrowUpRight : kpi.trend?.direction === "down" ? ArrowDownRight : Minus;
  const { tone, icon: Icon } = kpiVisual(kpi.id);
  const colors = KPI_TONES[tone];

  return (
    <Card
      data-kpi={kpi.id}
      className="@container relative h-full gap-0 rounded-[22px] border-slate-200/60 bg-white py-0 shadow-[0_1px_2px_rgb(16_32_56/0.04),0_10px_26px_-16px_rgb(16_32_56/0.16)] transition-shadow duration-200 hover:shadow-[0_1px_2px_rgb(16_32_56/0.05),0_14px_32px_-16px_rgb(16_32_56/0.22)]"
    >
      <span aria-hidden="true" data-kpi-line className={cn("absolute inset-x-0 top-0 h-[3px]", colors.line)} />
      {/* --kpi-pad: generous padding, a little tighter in a very narrow card so the figure keeps its room */}
      <CardContent className="flex h-full flex-col gap-2.5 px-(--kpi-pad) pt-[calc(var(--kpi-pad)+0.25rem)] pb-(--kpi-pad) [--kpi-pad:1.25rem] @min-[12rem]:[--kpi-pad:1.5rem]">
        {/* fixed height (the icon's): the figures of a row line up even when a label wraps */}
        <div className="flex min-h-10 items-start justify-between gap-3">
          <p className="min-w-0 pt-1 text-[0.82rem] leading-snug font-medium text-[var(--text-secondary)]">{kpi.label}</p>
          <span
            data-kpi-icon
            className={cn("flex size-10 shrink-0 items-center justify-center rounded-full ring-1", colors.circle)}
          >
            <Icon className={cn("size-[1.15rem]", colors.icon)} strokeWidth={1.75} aria-hidden="true" />
          </span>
        </div>

        <DirectionKpiValue
          value={kpi.value}
          maxRem={emphasis ? 2 : 1.75}
          className="font-heading leading-[1.1] font-bold tracking-[-0.03em] text-[var(--text-primary)]"
        />

        <div className="mt-auto flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 pt-1">
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
              <TrendIcon className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
              {kpi.trend.value}
            </span>
          ) : null}
          {kpi.trend ? <span className="text-[0.72rem] text-muted-foreground">vs période précédente</span> : null}
          {kpi.helper ? <span className="text-[0.72rem] text-muted-foreground">{kpi.helper}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
