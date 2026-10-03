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

/** One predicted day of a product: unrounded quantity, rounded to 1/100 for storage. */
export type DailyForecastPoint = { date: string; quantity: number };

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
  /** When the engine produced this row (dashboard "last update"). Optional: absent on rows read from a database without the column. */
  computedAt?: Date | null;
  /** The 7 daily predictions of this product (dashboard chart). null/absent: not stored. */
  dailyForecast?: DailyForecastPoint[] | null;
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
  computedAt: Date = new Date(),
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
      computedAt,
      dailyForecast: [...predictions]
        .filter((p) => p.horizonDay <= 7)
        .sort((a, b) => a.horizonDay - b.horizonDay)
        .map((p) => ({ date: p.predictionDate, quantity: Math.round(p.predictedQuantityRaw * 100) / 100 })),
    });
  }
  return rows;
}

/**
 * True for the error a database raises when a column the Prisma client knows
 * does not exist yet (migration not applied): Prisma code P2022, or the raw
 * Postgres message. The two new snapshot columns are optional, so every
 * read / write that touches them falls back to the previous shape instead of
 * breaking the AI Assistant, the cron or the dashboard during a deployment
 * that precedes the migration.
 */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "P2022") return true;
  const message = String((error as { message?: unknown }).message ?? "");
  return /column .* does not exist|does not exist in the current database/i.test(message);
}

/** Validates the stored JSON: an array of { date, quantity }, otherwise null (never guessed). */
export function parseDailyForecast(value: unknown): DailyForecastPoint[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const points: DailyForecastPoint[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { date, quantity } = item as { date?: unknown; quantity?: unknown };
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) return null;
    points.push({ date, quantity });
  }
  return points;
}

type RawSnapshotRow = {
  productId: string;
  productName: string;
  forecast1Day: number;
  forecast3Days: number;
  forecast7Days: number;
  predictedQuantityRaw: number;
  model: string;
  mae: number | null;
  reliability: string;
  historyDays: number;
  soldDays: number;
  computedAt?: Date | null;
  dailyForecast?: unknown;
};

const SNAPSHOT_BASE_SELECT = {
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
} as const;

/**
 * Latest snapshot day (<= `today`) of an organisation with its rows, or null
 * when the cache is empty. Used by the dashboard, which must NOT trigger the
 * forecast engine on page load: yesterday's snapshot is still shown (flagged by
 * the caller) when today's has not been computed yet. Reads the two optional
 * columns when they exist; on a database without them it returns the rows
 * without computedAt / dailyForecast.
 */
export async function readLatestSnapshot(
  db: ForecastDb,
  organizationId: string,
  today: string,
): Promise<{ businessDay: string; rows: SnapshotRow[] } | null> {
  const latest = await db.purchaseForecastSnapshot.findFirst({
    where: { organizationId, businessDay: { lte: today } },
    orderBy: { businessDay: "desc" },
    select: { businessDay: true },
  });
  if (!latest) return null;
  const businessDay = latest.businessDay;
  const where = { organizationId, businessDay };

  let withExtras: RawSnapshotRow[];
  try {
    withExtras = await db.purchaseForecastSnapshot.findMany({
      where,
      select: { ...SNAPSHOT_BASE_SELECT, computedAt: true, dailyForecast: true },
    });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    withExtras = await db.purchaseForecastSnapshot.findMany({ where, select: SNAPSHOT_BASE_SELECT });
  }

  return {
    businessDay,
    rows: withExtras.map((row) => ({
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
      computedAt: row.computedAt ?? null,
      dailyForecast: parseDailyForecast(row.dailyForecast),
    })),
  };
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
