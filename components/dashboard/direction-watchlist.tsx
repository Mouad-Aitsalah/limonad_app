import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import type { DirectionWatchItem } from "@/types/dashboard-direction";

const toneStyles: Record<DirectionWatchItem["tone"], string> = {
  danger: "bg-rose-50 text-rose-700",
  warning: "bg-amber-50 text-amber-700",
  neutral: "bg-sky-50 text-sky-700",
};

/** Deterministic rules only - no AI, no prediction (per spec §21). */
export function DirectionWatchlistCard({ items }: { items: DirectionWatchItem[] }) {
  return (
    <SectionCard title="A surveiller" contentClassName="space-y-2.5">
      {items.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Aucun point d&apos;attention actuellement.
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex items-center gap-2.5 rounded-2xl px-3.5 py-3 text-sm font-medium",
              toneStyles[item.tone],
            )}
          >
            {item.tone === "danger" ? (
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {item.label}
          </div>
        ))
      )}
    </SectionCard>
  );
}
