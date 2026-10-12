"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { BUCKET_STYLES, ESTIMATE_NOTE } from "@/components/dashboard/receivables/receivables-format";
import { formatCurrency } from "@/lib/utils";
import type { ReceivablesOverviewDto } from "@/types/receivables";

/**
 * Aging of the receivables (FIFO estimate) - bars + the same figures as a list,
 * readable without the chart (screen readers, print, tests).
 */
export function ReceivablesAgingChart({ buckets, total }: { buckets: ReceivablesOverviewDto["buckets"]; total: number }) {
  const data = buckets.map((bucket) => ({ ...bucket, label: BUCKET_STYLES[bucket.key].label }));
  return (
    <div className="space-y-3" data-chart="aging">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Répartition par ancienneté</h3>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.7rem] font-medium text-amber-900">
          Estimation FIFO
        </span>
      </div>
      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "rgba(148,163,184,0.12)" }}
              formatter={(value) => [formatCurrency(Number(value)), "Montant"]}
            />
            <Bar dataKey="amount" radius={[8, 8, 0, 0]} maxBarSize={72}>
              {data.map((entry) => (
                <Cell key={entry.key} fill={BUCKET_STYLES[entry.key].bar} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Répartition des créances par ancienneté">
        {buckets.map((bucket) => {
          const share = total > 0 ? Math.round((bucket.amount / total) * 1000) / 10 : 0;
          return (
            <li key={bucket.key} data-bucket={bucket.key} className="rounded-xl border border-border bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden="true" className={`size-2 rounded-full ${BUCKET_STYLES[bucket.key].dot}`} />
                {BUCKET_STYLES[bucket.key].label}
              </div>
              <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{formatCurrency(bucket.amount)}</p>
              <p className="text-[0.7rem] text-muted-foreground">
                {share.toLocaleString("fr-FR")} % · {bucket.customerCount} client{bucket.customerCount > 1 ? "s" : ""}
              </p>
            </li>
          );
        })}
      </ul>
      <p role="note" className="text-[0.72rem] leading-relaxed text-muted-foreground">
        {ESTIMATE_NOTE}
      </p>
    </div>
  );
}
