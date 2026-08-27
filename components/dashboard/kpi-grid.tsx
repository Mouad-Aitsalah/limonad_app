import { Boxes, Receipt, ShoppingCart, TrendingUp, Wallet } from "lucide-react";

import type { DashboardMetric } from "@/lib/server/dashboard";
import { MetricCard } from "@/components/ui/metric-card";

const metricIcons = {
  revenue: Wallet,
  "sales-count": ShoppingCart,
  basket: TrendingUp,
  stock: Boxes,
  charges: Receipt,
} as const;

export function KpiGrid({ metrics }: { metrics: DashboardMetric[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-5">
      {metrics.map((metric) => (
        <MetricCard
          key={metric.id}
          eyebrow={metric.eyebrow}
          title={metric.title}
          value={metric.value}
          helper={metric.helper}
          accent={metric.accent}
          trend={metric.trend}
          icon={metricIcons[metric.id as keyof typeof metricIcons] ?? Wallet}
        />
      ))}
    </div>
  );
}
