import { getCurrentBusinessDayParam } from "@/lib/business-day";
import { computePriceTTC } from "@/lib/product-pricing";
import { roundMoney } from "@/lib/money";
import type {
  DashboardForecastDailyPoint,
  DashboardForecastDto,
  DashboardForecastEmpty,
  DashboardForecastNoRecentSales,
  DashboardForecastReady,
  DashboardForecastRow,
  ForecastQuality,
  ForecastReliability,
} from "@/types/dashboard-forecast";

import { addDays } from "./daily-sales-series";
import { queryLastSaleDayByProduct, type ForecastDb } from "./product-daily-sales";
import { buildPurchaseRecommendationsFromSnapshot, type PurchaseRecommendation } from "./purchase-recommendation";
import { readLatestSnapshot, type SnapshotRow } from "./purchase-forecast-snapshot";

/**
 * Dashboard section "Intelligence & Prévisions IA" - read side.
 *
 * NOTHING is computed by the forecast engine here: the forecast comes from the
 * daily cache (PurchaseForecastSnapshot, filled by the cron), the stock and the
 * purchase quantity from the existing recommendation formula
 * (computeRecommendation, via buildPurchaseRecommendationsFromSnapshot - same
 * code as the AI Assistant tool), the price from the live catalogue. When the
 * cache holds nothing the section says so - the engine is never run on a page
 * load and no value is ever invented.
 *
 * Coverage is the fixed 7 days of the existing formula: the supplier lead time
 * is not stored yet, so the recommendations are indicative.
 */

/** Rows shown in the products table (sorted by quantity to order); the rest is counted. */
export const FORECAST_TABLE_LIMIT = 20;

export type ForecastProductInfo = {
  reference: string;
  status: string;
  salePrice: number;
  taxRate: number;
};

/** Overall quality from the number of products per reliability level. */
export function assessForecastQuality(counts: Record<ForecastReliability, number>): ForecastQuality {
  const total = counts.sufficient + counts.limited + counts.very_limited + counts.none;
  if (counts.sufficient + counts.limited === 0 || total === 0) return "insufficient";
  return counts.sufficient / total >= 0.5 ? "sufficient" : "limited";
}

/**
 * Sum of the stored per-product daily predictions, per date. null when any of
 * the products has no stored detail (snapshot computed before the column
 * existed): a partial chart would understate the forecast.
 */
export function sumDailyForecast(rows: Pick<SnapshotRow, "dailyForecast">[]): DashboardForecastDailyPoint[] | null {
  if (rows.length === 0) return null;
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.dailyForecast || row.dailyForecast.length === 0) return null;
    for (const point of row.dailyForecast) {
      totals.set(point.date, (totals.get(point.date) ?? 0) + point.quantity);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, quantity]) => ({ date, quantity: Math.max(0, Math.round(quantity)) }));
}

/** Whole days from `from` to `to` ("YYYY-MM-DD"), never negative. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type BuildDashboardForecastInput = {
  today: string;
  snapshot: { businessDay: string; rows: SnapshotRow[] } | null;
  recommendations: PurchaseRecommendation[];
  products: Map<string, ForecastProductInfo>;
  /** Last business day with a sale per product (absent = unknown / never sold). */
  lastSaleDays?: Map<string, string>;
};

export function buildDashboardForecast(input: BuildDashboardForecastInput): DashboardForecastReady | DashboardForecastEmpty {
  const { snapshot } = input;
  if (!snapshot || snapshot.rows.length === 0) return { status: "empty", reason: "no_snapshot" };

  // Only products that are sold today appear (an inactive / discontinued product is never recommended).
  const active = input.recommendations.filter((rec) => rec.productStatus === "ACTIVE");
  if (active.length === 0) return { status: "empty", reason: "no_products" };

  const activeIds = new Set(active.map((rec) => rec.productId));
  // The forecast starts the day after the last complete day it was built from.
  const asOf = addDays(snapshot.businessDay, -1);
  const rowsAll: DashboardForecastRow[] = active
    .map((rec) => {
      const lastSaleDate = input.lastSaleDays?.get(rec.productId) ?? null;
      return {
        productId: rec.productId,
        reference: input.products.get(rec.productId)?.reference ?? "-",
        name: rec.productName,
        currentStock: rec.currentStock,
        forecast7Days: rec.forecast7Days,
        recommendedQuantity: rec.recommendedPurchaseQuantity,
        reliability: rec.reliability,
        mae: rec.mae,
        evaluable: rec.evaluable,
        noRecentSales: rec.noRecentSales,
        lastSaleDate,
        daysSinceLastSale: lastSaleDate ? daysBetween(lastSaleDate, asOf) : null,
        stockRegularizationRequired: rec.stockRegularizationRequired,
        reason: rec.reason,
      };
    })
    .sort(
      (a, b) =>
        b.recommendedQuantity - a.recommendedQuantity ||
        b.forecast7Days - a.forecast7Days ||
        a.name.localeCompare(b.name, "fr") ||
        a.productId.localeCompare(b.productId),
    );

  const totalUnits7Days = active.reduce((sum, rec) => sum + rec.forecast7Days, 0);
  const revenue7Days = roundMoney(
    active.reduce((sum, rec) => {
      const info = input.products.get(rec.productId);
      return info ? sum + rec.forecast7Days * computePriceTTC(info.salePrice, info.taxRate) : sum;
    }, 0),
  );

  const reliabilityCounts: Record<ForecastReliability, number> = { sufficient: 0, limited: 0, very_limited: 0, none: 0 };
  for (const rec of active) reliabilityCounts[rec.reliability] += 1;

  const snapshotRows = snapshot.rows.filter((row) => activeIds.has(row.productId));

  // History exists but the forecast is 0 because nothing sold recently: say why,
  // with the days without sale and the latest sale of the whole catalogue.
  let noRecentSales: DashboardForecastNoRecentSales | null = null;
  if (totalUnits7Days === 0 && active.some((rec) => rec.noRecentSales)) {
    const lastDates = rowsAll.map((row) => row.lastSaleDate).filter((date): date is string => date !== null);
    const lastSaleDate = lastDates.length > 0 ? lastDates.reduce((max, date) => (date > max ? date : max)) : null;
    noRecentSales = { lastSaleDate, daysWithoutSale: lastSaleDate ? daysBetween(lastSaleDate, asOf) : null };
  }
  const computedTimes = snapshot.rows
    .map((row) => row.computedAt?.getTime())
    .filter((time): time is number => typeof time === "number" && Number.isFinite(time));

  return {
    status: "ready",
    businessDay: snapshot.businessDay,
    isCurrent: snapshot.businessDay === input.today,
    computedAt: computedTimes.length > 0 ? new Date(Math.max(...computedTimes)).toISOString() : null,
    totalUnits7Days,
    revenue7Days,
    daily: sumDailyForecast(snapshotRows),
    rows: rowsAll.slice(0, FORECAST_TABLE_LIMIT),
    hiddenRowCount: Math.max(0, rowsAll.length - FORECAST_TABLE_LIMIT),
    reliabilityCounts,
    quality: assessForecastQuality(reliabilityCounts),
    toOrderCount: rowsAll.filter((row) => row.recommendedQuantity > 0).length,
    negativeStockCount: rowsAll.filter((row) => row.stockRegularizationRequired).length,
    noRecentSales,
  };
}

/**
 * Organisation-level entry point (no auth here; the session-scoped wrapper is
 * lib/server/dashboard-forecast.ts). Three light reads: the latest snapshot,
 * the live stock / 28-day window of the recommendation formula, the catalogue.
 */
export async function getDashboardForecastFor(
  db: ForecastDb,
  organizationId: string,
  now: Date = new Date(),
): Promise<DashboardForecastDto> {
  const today = getCurrentBusinessDayParam(now);
  const snapshot = await readLatestSnapshot(db, organizationId, today);
  if (!snapshot || snapshot.rows.length === 0) return { status: "empty", reason: "no_snapshot" };

  const asOf = addDays(snapshot.businessDay, -1);
  const [{ recommendations }, products, lastSaleDays] = await Promise.all([
    buildPurchaseRecommendationsFromSnapshot(db, organizationId, asOf, snapshot.rows),
    db.product.findMany({
      where: { organizationId },
      select: { id: true, reference: true, status: true, salePrice: true, taxRate: true },
    }),
    queryLastSaleDayByProduct(db, organizationId, asOf),
  ]);

  return buildDashboardForecast({
    today,
    snapshot,
    recommendations,
    lastSaleDays,
    products: new Map(
      products.map((product) => [
        product.id,
        {
          reference: product.reference,
          status: product.status,
          salePrice: Number(product.salePrice),
          taxRate: Number(product.taxRate),
        },
      ]),
    ),
  });
}

export const FORECAST_LOAD_ERROR_MESSAGE =
  "Les prévisions n'ont pas pu être chargées pour le moment. Le reste du dashboard n'est pas affecté.";

/**
 * Permission + error handling around the read, with the collaborators injected
 * (the route-less server wrapper lib/server/dashboard-forecast.ts supplies the
 * real session check, database and error reporter):
 *  - `requireUser` throws for a role that may not see the forecast (403) or a
 *    missing session (401): that error is NOT swallowed - the caller must never
 *    be able to read the data;
 *  - any failure of the read itself becomes a "error" DTO (reported once), so a
 *    forecast problem never takes the whole dashboard down.
 */
export async function loadDashboardForecast(deps: {
  requireUser: () => Promise<{ organizationId: string }>;
  load: (organizationId: string) => Promise<DashboardForecastDto>;
  report?: (error: unknown) => void;
}): Promise<DashboardForecastDto> {
  const user = await deps.requireUser();
  try {
    return await deps.load(user.organizationId);
  } catch (error) {
    deps.report?.(error);
    return { status: "error", message: FORECAST_LOAD_ERROR_MESSAGE };
  }
}
