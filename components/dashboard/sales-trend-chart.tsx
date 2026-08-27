"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency } from "@/lib/currency";
import type { DashboardTrendPoint } from "@/lib/server/dashboard";
import { SectionCard } from "@/components/ui/section-card";

export function SalesTrendChart({ data }: { data: DashboardTrendPoint[] }) {
  return (
    <SectionCard
      title="Evolution des ventes"
      description="30 derniers jours, base sur les ventes validees."
      contentClassName="h-[340px]"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0f7a5d" stopOpacity={0.34} />
              <stop offset="95%" stopColor="#0f7a5d" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            interval={4}
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
            formatter={(value) => [formatCurrency(Number(value)), "Ventes"]}
          />
          <Area
            type="monotone"
            dataKey="ventes"
            stroke="#0f7a5d"
            strokeWidth={2.5}
            fill="url(#salesGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </SectionCard>
  );
}
