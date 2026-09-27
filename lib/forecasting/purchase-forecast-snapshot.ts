import type { ModelName, SalesPrediction } from "./forecast-engine";
import { sumForecastDays } from "./forecast-engine";
import type { ForecastDb } from "./product-daily-sales";
import type { SalesForecastResult } from "./sales-forecast";

/**
 * Forecasting step 4 - "PRÉCALCUL / CACHE": the daily snapshot.
 *
 * ONE row per organisation, business day (lib/business-day.ts's existing
 * 02h-02h Casablanca rule - reused, never redefined here) and product,
 * holding ONLY the ML-side forecast result. It deliberately never stores
 * currentStock, safetyStock, targetStock, recommendedPurchase or a stock
 * alert: those always come from a fresh stock read + computeRecommendation()
 * at request time (lib/forecasting/purchase-recommendation.ts) - a stock
 * change is reflected immediately without ever redoing the forecast.
 */

export type SnapshotRow = {
  organizationId: string;
  businessDay: string;
  productId: string;
  productName: string;
  forecast1Day: number;
  forecast3Days: number;
  forecast7Days: number;
  /** Sum of the 7 daily predictions, unrounded - kept for future use, not fed back into computeRecommendation. */
  predictedQuantityRaw: number;
  model: ModelName;
  mae: number | null;
  reliability: string;
  historyDays: number;
  soldDays: number;
};

/**
 * Reduces an already-computed SalesForecastResult (lib/forecasting/sales-
 * forecast.ts - the full engine: history, chronological evaluation, Random
 * Forest) to one snapshot row per product. Pure: no DB access, no ML logic of
 * its own - it only reads the engine's own output, exactly the same figures
 * the live path (buildPurchaseRecommendationsLive) derives from it.
 */
export function buildSnapshotRows(
  organizationId: string,
  businessDay: string,
  forecast: SalesForecastResult,
): SnapshotRow[] {
  const predictionsByProduct = new Map<string, SalesPrediction[]>();
  for (const prediction of forecast.predictions) {
    const list = predictionsByProduct.get(prediction.productId) ?? [];
    list.push(prediction);
    predictionsByProduct.set(prediction.productId, list);
  }

  const nameById = new Map(forecast.series.map((series) => [series.productId, series.productName]));
  const historyById = new Map(forecast.series.map((series) => [series.productId, series.values]));

  const rows: SnapshotRow[] = [];
  for (const [productId, predictions] of predictionsByProduct) {
    const history = historyById.get(productId) ?? [];
    const rawSum7 = predictions
      .filter((p) => p.horizonDay <= 7)
      .reduce((sum, p) => sum + p.predictedQuantityRaw, 0);
    rows.push({
      organizationId,
      businessDay,
      productId,
      productName: nameById.get(productId) ?? predictions[0]?.productName ?? productId,
      forecast1Day: sumForecastDays(predictions, 1),
      forecast3Days: sumForecastDays(predictions, 3),
      forecast7Days: sumForecastDays(predictions, 7),
      predictedQuantityRaw: rawSum7,
      model: predictions[0]?.model ?? "moving_average",
      mae: predictions[0]?.mae ?? null,
      reliability: assessSnapshotReliability(history.length, history.filter((value) => value > 0).length),
      historyDays: history.length,
      soldDays: history.filter((value) => value > 0).length,
    });
  }
  return rows;
}

/**
 * Same thresholds as purchase-recommendation.ts's assessReliability - kept as
 * a tiny local copy (a plain string label stored for reference/explainability
 * only) so this pure module never imports the recommendation layer. The read
 * path always recomputes reliability itself from historyDays/soldDays via
 * assessReliability(), so this stored copy can never drift into a wrong
 * recommendation even if it were stale.
 */
function assessSnapshotReliability(historyDays: number, soldDays: number): string {
  if (soldDays === 0) return "none";
  if (historyDays < 21 || soldDays < 5) return "very_limited";
  if (historyDays < 60 || soldDays < 15) return "limited";
  return "sufficient";
}

/** Snapshot rows of one organisation and business day, or [] when none was computed yet. */
export async function readSnapshotRows(
  db: ForecastDb,
  organizationId: string,
  businessDay: string,
): Promise<SnapshotRow[]> {
  const rows = await db.purchaseForecastSnapshot.findMany({
    where: { organizationId, businessDay },
    select: {
      productId: true,
      productName: true,
      forecast1Day: true,
      forecast3Days: true,
      forecast7Days: true,
      predictedQuantityRaw: true,
      model: true,
      mae: true,
      reliability: true,
      historyDays: true,
      soldDays: true,
    },
  });
  return rows.map((row) => ({
    organizationId,
    businessDay,
    productId: row.productId,
    productName: row.productName,
    forecast1Day: row.forecast1Day,
    forecast3Days: row.forecast3Days,
    forecast7Days: row.forecast7Days,
    predictedQuantityRaw: row.predictedQuantityRaw,
    model: row.model as ModelName,
    mae: row.mae,
    reliability: row.reliability,
    historyDays: row.historyDays,
    soldDays: row.soldDays,
  }));
}
