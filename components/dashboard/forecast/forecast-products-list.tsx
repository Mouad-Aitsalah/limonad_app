import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatAccuracy,
  formatLastSale,
  RELIABILITY_BADGE_CLASS,
  RELIABILITY_LABEL,
} from "@/lib/forecasting/forecast-format";
import { cn } from "@/lib/utils";
import type { DashboardForecastRow } from "@/types/dashboard-forecast";

function Reliability({ value }: { value: DashboardForecastRow["reliability"] }) {
  return (
    <Badge variant="outline" className={RELIABILITY_BADGE_CLASS[value]}>
      {RELIABILITY_LABEL[value]}
    </Badge>
  );
}

function Recommended({ row }: { row: DashboardForecastRow }) {
  if (row.stockRegularizationRequired) {
    return <span className="text-xs font-semibold text-rose-700">Stock à régulariser</span>;
  }
  if (row.recommendedQuantity <= 0) return <span className="text-muted-foreground">Aucun achat</span>;
  return <span className="font-bold text-emerald-700">{row.recommendedQuantity.toLocaleString("fr-FR")}</span>;
}

/**
 * Products with their forecast. From xl (1280px): a table - narrower screens
 * share the page with the sidebar and are too tight for 6 columns. Below: one compact
 * card per product (same convention as the Stock and Produits pages).
 */
export function ForecastProductsList({ rows }: { rows: DashboardForecastRow[] }) {
  return (
    <>
      <div className="max-xl:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Référence</TableHead>
              <TableHead>Désignation</TableHead>
              <TableHead className="text-right">Stock actuel</TableHead>
              <TableHead className="text-right">Ventes prévues (7 j)</TableHead>
              <TableHead className="text-right">Qté recommandée</TableHead>
              <TableHead>Fiabilité</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.productId} title={row.reason}>
                <TableCell className="max-w-[12rem] font-medium whitespace-normal text-foreground [overflow-wrap:anywhere]">
                  {row.reference}
                </TableCell>
                <TableCell className="max-w-[20rem] whitespace-normal text-foreground [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
                  {row.name}
                </TableCell>
                <TableCell
                  className={cn("text-right tabular-nums", row.currentStock < 0 && "font-semibold text-rose-700")}
                >
                  {row.currentStock.toLocaleString("fr-FR")}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.forecast7Days.toLocaleString("fr-FR")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <Recommended row={row} />
                </TableCell>
                <TableCell className="max-w-[14rem] whitespace-normal">
                  <Reliability value={row.reliability} />
                  <p className={cn("mt-1 text-xs text-muted-foreground", !row.evaluable && "italic")}>
                    Précision : {formatAccuracy(row.mae, row.evaluable)}
                  </p>
                  {row.noRecentSales && row.lastSaleDate ? (
                    <p className="text-xs text-muted-foreground" data-testid="forecast-last-sale">
                      {formatLastSale(row.lastSaleDate, row.daysSinceLastSale)}
                    </p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-2.5 sm:grid-cols-2 xl:hidden" data-testid="forecast-mobile-list">
        {rows.map((row) => (
          <li
            key={row.productId}
            className="min-w-0 rounded-2xl border border-border/70 bg-white p-3 shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-bold text-foreground [overflow-wrap:anywhere]">{row.reference}</p>
              <Reliability value={row.reliability} />
            </div>
            <p className="mt-0.5 text-sm leading-snug text-foreground [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
              {row.name}
            </p>
            {row.noRecentSales && row.lastSaleDate ? (
              <p className="mt-1 text-xs text-muted-foreground">{formatLastSale(row.lastSaleDate, row.daysSinceLastSale)}</p>
            ) : null}
            <dl className="mt-2.5 grid grid-cols-3 gap-2 text-center">
              <div className="min-w-0 rounded-xl bg-slate-50 px-1.5 py-1.5">
                <dt className="text-[11px] font-medium text-muted-foreground">Stock</dt>
                <dd className={cn("text-sm font-semibold tabular-nums", row.currentStock < 0 && "text-rose-700")}>
                  {row.currentStock.toLocaleString("fr-FR")}
                </dd>
              </div>
              <div className="min-w-0 rounded-xl bg-slate-50 px-1.5 py-1.5">
                <dt className="text-[11px] font-medium text-muted-foreground">Prévu 7 j</dt>
                <dd className="text-sm font-semibold tabular-nums">{row.forecast7Days.toLocaleString("fr-FR")}</dd>
              </div>
              <div className="min-w-0 rounded-xl bg-emerald-50 px-1.5 py-1.5">
                <dt className="text-[11px] font-medium text-emerald-800/80">À commander</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  <Recommended row={row} />
                </dd>
              </div>
            </dl>
            <p className={cn("mt-2 text-xs", row.evaluable ? "text-muted-foreground" : "text-muted-foreground/80 italic")}>
              Précision : {formatAccuracy(row.mae, row.evaluable)}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
