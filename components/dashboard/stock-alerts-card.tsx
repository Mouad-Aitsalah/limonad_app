import { PackageX } from "lucide-react";

import type { DashboardStockAlert } from "@/lib/server/dashboard";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";

export function StockAlertsCard({ alerts }: { alerts: DashboardStockAlert[] }) {
  return (
    <SectionCard
      title="Alertes de stock"
      description="Produits sous le seuil de reapprovisionnement."
      contentClassName="space-y-3"
    >
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-center gap-3 rounded-[22px] border border-border/70 bg-white/78 px-3 py-3"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <PackageX aria-hidden="true" className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{alert.product}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {alert.sku} · {alert.quantity} / {alert.threshold} en stock
            </p>
          </div>

          <StatusBadge
            value={alert.severity === "critique" ? "OUT_OF_STOCK" : "LOW_STOCK"}
            label={alert.severity}
          />
        </div>
      ))}
    </SectionCard>
  );
}
