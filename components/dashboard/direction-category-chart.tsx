"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatCurrency } from "@/lib/currency";
import { SectionCard } from "@/components/ui/section-card";
import type { DirectionCategoryPoint } from "@/types/dashboard-direction";

export function DirectionCategoryChart({ data }: { data: DirectionCategoryPoint[] }) {
  const hasData = data.length > 0;

  return (
    <SectionCard
      title="Ventes par categorie"
      description="Repartition du chiffre d'affaires sur la periode selectionnee."
      contentClassName="space-y-5"
    >
      {hasData ? (
        <>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="ca"
                  nameKey="category"
                  innerRadius={68}
                  outerRadius={96}
                  paddingAngle={4}
                  strokeWidth={0}
                >
                  {data.map((entry) => (
                    <Cell key={entry.category} fill={entry.color} />
                  ))}
                </Pie>
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
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="grid gap-2.5">
            {data.map((entry) => (
              <li
                key={entry.category}
                className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white/75 px-3 py-2"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden="true"
                />
                <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {entry.category}
                </span>
                <span className="ml-auto text-right text-xs text-[var(--text-secondary)]">
                  {entry.unitsSold.toLocaleString("fr-FR")} u.
                </span>
                <span className="w-16 text-right text-sm font-semibold text-[var(--text-secondary)]">
                  {entry.percentage.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          Aucune vente sur cette periode.
        </div>
      )}
    </SectionCard>
  );
}
