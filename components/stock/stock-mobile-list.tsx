import type { ReactNode } from "react";

import { cn, formatCurrency } from "@/lib/utils";

/**
 * Phone / tablet (< lg) presentation of the stock tables: one card per stock
 * line with only the essentials - product (name in bold, reference below),
 * current stock and stock value. Pure presentation: `quantity` and `value`
 * are the figures the desktop table already shows (StockLevelDto.quantity /
 * stockValue, computed server-side), nothing is recomputed here. The desktop
 * table (>= lg) is untouched; callers render this list under `lg:hidden`.
 */
export type StockMobileItem = {
  id: string;
  name: string;
  reference: string;
  /** Location code, only for lists mixing several locations (all-locations tab). */
  location?: string;
  quantity: number;
  value: number;
  /** Colours the stock figure like the desktop table (red = out, amber = low). */
  tone?: "danger" | "warning" | "success";
  /** Optional per-line action (truck tab: "Ajuster"). */
  action?: ReactNode;
};

export function StockMobileList({ items }: { items: StockMobileItem[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="stock-mobile-list">
      {items.map((item) => (
        <li
          key={item.id}
          className="min-w-0 rounded-2xl border border-border/70 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
        >
          {/* Long and Arabic names wrap instead of overflowing; plaintext lets an
              Arabic name start on its own side. */}
          <p className="text-base leading-snug font-bold text-foreground [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
            {item.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {item.reference}
            {item.location ? ` · ${item.location}` : ""}
          </p>

          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-end gap-x-4 border-t border-border/60 pt-3">
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Stock actuel
              </dt>
              <dd
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  item.tone === "danger" && "text-red-600",
                  item.tone === "warning" && "text-amber-600",
                )}
              >
                {item.quantity}
              </dd>
            </div>
            <div className="min-w-0 text-right">
              <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Valeur du stock
              </dt>
              <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">
                {formatCurrency(item.value)}
              </dd>
            </div>
          </dl>

          {item.action ? <div className="mt-3">{item.action}</div> : null}
        </li>
      ))}
    </ul>
  );
}
