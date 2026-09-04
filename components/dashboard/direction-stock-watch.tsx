import { PackageX } from "lucide-react";

import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DirectionStockWatch } from "@/types/dashboard-direction";

const severityLabel: Record<string, string> = {
  negative: "Negatif",
  rupture: "Rupture",
  low: "Sous seuil",
};

const severityStatusValue: Record<string, string> = {
  negative: "OUT_OF_STOCK",
  rupture: "OUT_OF_STOCK",
  low: "LOW_STOCK",
};

export function DirectionStockWatchCard({ data }: { data: DirectionStockWatch }) {
  return (
    <SectionCard
      title="A surveiller - Stock"
      description="Produits en rupture, sous seuil ou en stock negatif."
      contentClassName="space-y-4"
    >
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border/70 bg-white/78 px-3 py-2.5 text-center">
          <p className="text-lg font-bold text-[var(--text-primary)]">{data.outOfStockProducts}</p>
          <p className="text-xs text-muted-foreground">Ruptures</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-white/78 px-3 py-2.5 text-center">
          <p className="text-lg font-bold text-[var(--text-primary)]">{data.lowStockProducts}</p>
          <p className="text-xs text-muted-foreground">Sous seuil</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-white/78 px-3 py-2.5 text-center">
          <p className="text-lg font-bold text-[var(--text-primary)]">{data.negativeStockProducts}</p>
          <p className="text-xs text-muted-foreground">Stocks negatifs</p>
        </div>
      </div>

      {data.critical.length > 0 ? (
        <div className="space-y-2.5">
          {data.critical.map((item) => (
            <div
              key={item.productId}
              className="flex items-center gap-3 rounded-[20px] border border-border/70 bg-white/78 px-3 py-2.5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                <PackageX aria-hidden="true" className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.reference} - {item.available} / {item.minimumStock} en stock
                </p>
              </div>
              <StatusBadge value={severityStatusValue[item.severity]} label={severityLabel[item.severity]} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun produit critique actuellement.</p>
      )}
    </SectionCard>
  );
}
