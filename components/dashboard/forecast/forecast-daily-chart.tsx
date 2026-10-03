"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatForecastDay } from "@/lib/forecasting/forecast-format";
import type { DashboardForecastDailyPoint } from "@/types/dashboard-forecast";

/** Units forecast per day over the next 7 days (sum of the whole catalogue). */
export function ForecastDailyChart({ points }: { points: DashboardForecastDailyPoint[] }) {
  const data = points.map((point) => ({ label: formatForecastDay(point.date), quantity: point.quantity }));

  return (
    <div className="h-[220px] w-full" role="img" aria-label="Ventes prévues par jour sur les 7 prochains jours">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={38}
            allowDecimals={false}
            tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
          />
          <Tooltip
            cursor={{ fill: "rgba(15,122,93,0.06)" }}
            contentStyle={{
              borderRadius: 18,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.96)",
              boxShadow: "0 18px 32px rgba(15,23,42,0.12)",
              fontSize: 13,
            }}
            formatter={(value) => [`${Number(value).toLocaleString("fr-FR")} unités`, "Ventes prévues"]}
          />
          <Bar dataKey="quantity" name="Ventes prévues" fill="#0f7a5d" radius={[8, 8, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
