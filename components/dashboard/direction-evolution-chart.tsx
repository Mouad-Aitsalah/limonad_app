"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency } from "@/lib/currency";
import { SectionCard } from "@/components/ui/section-card";
import type { BiGranularity } from "@/lib/server/dashboard-bi";
import type { DirectionSeriesPoint } from "@/types/dashboard-direction";

const granularityDescription: Record<BiGranularity, string> = {
  hour: "Par heure",
  day: "Par jour",
  week: "Par semaine",
  month: "Par mois",
};

export function DirectionEvolutionChart({
  granularity,
  points,
}: {
  granularity: BiGranularity;
  points: DirectionSeriesPoint[];
}) {
  const hasData = points.some((point) => point.ca > 0 || point.margin !== 0);

  return (
    <SectionCard
      title="Evolution CA & Marge"
      description={`${granularityDescription[granularity]}, sur la periode selectionnee.`}
      contentClassName="h-[340px]"
    >
      {hasData ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={46}
              tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
              tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 18,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.96)",
                boxShadow: "0 18px 32px rgba(15,23,42,0.12)",
                fontSize: 13,
              }}
              formatter={(value, name) => [formatCurrency(Number(value)), name]}
            />
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }}
            />
            <Line
              type="monotone"
              dataKey="ca"
              name="CA TTC"
              stroke="#0f7a5d"
              strokeWidth={2.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="margin"
              name="Marge brute HT"
              stroke="#2b6cb0"
              strokeWidth={2.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Aucune vente sur cette periode.
        </div>
      )}
    </SectionCard>
  );
}
