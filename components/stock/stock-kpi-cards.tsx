import { AlertTriangle, Boxes, CircleOff, PackageCheck, Truck } from "lucide-react";

import { MetricCard } from "@/components/ui/metric-card";
import { formatCurrency } from "@/lib/utils";
import type { StockTotals } from "@/lib/stock-calculations";

const kpiItems = [
  {
    key: "totalValue",
    eyebrow: "Valeur",
    title: "Stock total",
    icon: PackageCheck,
    accent: "green",
  },
  {
    key: "productCount",
    eyebrow: "Catalogue",
    title: "Produits suivis",
    icon: Boxes,
    accent: "blue",
  },
  {
    key: "outOfStockCount",
    eyebrow: "Ruptures",
    title: "Produits en rupture",
    icon: CircleOff,
    accent: "red",
  },
  {
    key: "lowStockCount",
    eyebrow: "Alertes",
    title: "Produits sous seuil",
    icon: AlertTriangle,
    accent: "orange",
  },
  {
    key: "trucksValue",
    eyebrow: "Camions",
    title: "Valeur embarquee",
    icon: Truck,
    accent: "navy",
  },
] as const;

export function StockKpiCards({ totals }: { totals: StockTotals }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {kpiItems.map((item) => {
        const rawValue = totals[item.key];
        const value =
          item.key === "totalValue" || item.key === "trucksValue"
            ? formatCurrency(rawValue)
            : rawValue.toLocaleString("fr-FR");

        return (
          <MetricCard
            key={item.key}
            eyebrow={item.eyebrow}
            title={item.title}
            value={value}
            helper=""
            icon={item.icon}
            accent={item.accent}
          />
        );
      })}
    </div>
  );
}
