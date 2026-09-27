import { addDays } from "./daily-sales-series";
import { getCurrentBusinessDayParam } from "@/lib/business-day";

import {
  evaluateProduct,
  forecastProduct,
  summarizeEvaluations,
  DEFAULT_TEST_DAYS,
  type DailySeries,
  type ProductEvaluation,
  type SalesPrediction,
} from "./forecast-engine";
import { buildProductDailySalesDataset, type ForecastDb } from "./product-daily-sales";

/**
 * Forecasting step 2 - organisation-level entry point (no auth here; the
 * session-scoped wrapper is lib/server/sales-forecast.ts).
 *
 * The history comes ONLY from step 1 (buildProductDailySalesDataset, complete
 * Produit x Jour series): same sale statuses as dashboard-bi.ts, soldAt over
 * validatedAt, business day 02h-02h Casablanca, filtered by organizationId.
 * No second sales query exists in this layer.
 */

export type SalesForecastOptions = {
  /**
   * Last day of history considered complete ("YYYY-MM-DD"). Default: the last
   * CLOSED business day (yesterday), since today's sales are still coming in.
   * The first prediction is the day after it.
   */
  asOf?: string;
  /** Number of days to predict, 1 to 7. Default 1 (J+1). */
  horizon?: number;
  /** Chronological test window, in days. Default 14. */
  testDays?: number;
};

export type SalesForecastResult = {
  asOf: string;
  horizon: number;
  predictions: SalesPrediction[];
  evaluations: ProductEvaluation[];
  /** The complete daily series the forecast was built from (reused by step 3, no second load). */
  series: DailySeries[];
  summary: ReturnType<typeof summarizeEvaluations>;
};

/** Groups the complete dataset rows into one consecutive series per product. */
export function toDailySeries(
  rows: Array<{ date: string; productId: string; productName: string; quantitySold: number }>,
): DailySeries[] {
  const byProduct = new Map<string, DailySeries>();
  for (const row of rows) {
    const series = byProduct.get(row.productId) ?? {
      productId: row.productId,
      productName: row.productName,
      dates: [],
      values: [],
    };
    series.dates.push(row.date);
    series.values.push(row.quantitySold);
    byProduct.set(row.productId, series);
  }
  return [...byProduct.values()];
}

export async function buildSalesForecast(
  db: ForecastDb,
  organizationId: string,
  options: SalesForecastOptions = {},
): Promise<SalesForecastResult> {
  const asOf = options.asOf ?? addDays(getCurrentBusinessDayParam(), -1);
  const horizon = Math.min(Math.max(Math.trunc(options.horizon ?? 1), 1), 7);

  const rows = await buildProductDailySalesDataset(db, organizationId, { complete: true, to: asOf });
  const evaluations: ProductEvaluation[] = [];
  const predictions: SalesPrediction[] = [];

  const allSeries = toDailySeries(rows);
  for (const series of allSeries) {
    const evaluation = evaluateProduct(series, { testDays: options.testDays ?? DEFAULT_TEST_DAYS });
    evaluations.push(evaluation);
    predictions.push(...forecastProduct(series, evaluation, { horizon }));
  }

  return { asOf, horizon, predictions, evaluations, series: allSeries, summary: summarizeEvaluations(evaluations) };
}
