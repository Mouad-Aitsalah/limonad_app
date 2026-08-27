"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { DashboardCategoryPoint } from "@/lib/server/dashboard";
import { SectionCard } from "@/components/ui/section-card";

export function CategoryDonutChart({ data }: { data: DashboardCategoryPoint[] }) {
  return (
    <SectionCard
      title="Ventes par categorie"
      description="Repartition du chiffre d'affaires sur les 30 derniers jours."
      contentClassName="space-y-5"
    >
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="category"
              innerRadius={72}
              outerRadius={102}
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
              formatter={(value, name) => [`${value}%`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="grid gap-3">
        {data.map((entry) => (
          <li
            key={entry.category}
            className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white/75 px-3 py-2.5"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span className="truncate text-sm font-medium text-[var(--text-primary)]">
              {entry.category}
            </span>
            <span className="ml-auto text-sm font-semibold text-[var(--text-secondary)]">
              {entry.value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
