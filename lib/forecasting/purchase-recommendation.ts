import { getCurrentBusinessDayParam } from "@/lib/business-day";
import { Prisma } from "@/lib/generated/prisma/client";
import type { ProductStatus } from "@/lib/generated/prisma/client";

import { addDays } from "./daily-sales-series";
import { stdDev } from "./features";
import { DEFAULT_TEST_DAYS, sumForecastDays, type DailySeries, type ModelName, type SalesPrediction } from "./forecast-engine";
import type { ForecastDb } from "./product-daily-sales";
import { buildProductDailySalesDataset } from "./product-daily-sales";
import { readSnapshotRows, type SnapshotRow } from "./purchase-forecast-snapshot";
import { buildSalesForecast, type SalesForecastOptions } from "./sales-forecast";

/**
 * Forecasting step 3 - purchase recommendation, step 4 - cache-aware read.
 *
 * FORMULA (all quantities are whole units), unchanged since step 3:
 *
 *   forecast7Days   = round( sum of the 7 daily predictions, unrounded )
 *   targetStock     = forecast7Days + safetyStock
 *   recommended     = max(0, targetStock - currentStock)
 *
 * computeRecommendation() is the SINGLE place this formula lives. Step 4 (the
 * daily snapshot, lib/forecasting/purchase-forecast-snapshot.ts) never
 * recomputes it differently: it feeds this exact function with either
 * freshly-computed or cached forecast figures - see RecommendationInput's own
 * doc comment for the two paths.
 *
 * CURRENT STOCK = SUM(StockLevel.quantity - StockLevel.reservedQuantity) over
 * the organisation's DEPOT and TRUCK locations - the same "available" quantity
 * and the same locations as the BI helpers (dashboard-bi.ts). ALWAYS read
 * live (queryCurrentStockByProduct), snapshot or not: the whole point of step
 * 4 is that a stock change is reflected immediately without redoing the ML
 * forecast.
 *   - NEGATIVE stock (negative sales are allowed) is reported as is, but it
 *     is NEVER turned into a purchase: recommended = 0 and
 *     `stockRegularizationRequired` is true ("Stock négatif à régulariser").
 *     A negative balance is more often a missing receipt / inventory entry than
 *     a real deficit, so the stock must be regularised first.
 *   - A product with NO StockLevel row is counted as 0 (what the POS shows for
 *     it) and flagged `stockKnown: false`; the reason says so.
 *
 * SAFETY STOCK (explainable, per product, not a fixed number):
 *   - demand_variability (history of at least 28 days and 5 days with sales):
 *       safetyStock = ceil( z * sigma * sqrt(7) )
 *     z = 1.28 (about a 90 % chance not to run out over the week), sigma =
 *     standard deviation of the daily quantities sold over the LAST 28 days
 *     (population std). The more irregular the sales, the bigger the margin.
 *   - fallback_half_week (shorter or sparser history): a prudent flat rule,
 *     safetyStock = ceil( 0.5 * forecast7Days ), i.e. half a week of demand.
 *   - none: forecast7Days is 0 and nothing was sold in the last 28 days ->
 *     safetyStock = 0, so a dead product never triggers a purchase.
 *
 * SPECIAL CASES: never sold -> 0 (reliability "none"); INACTIVE or
 * DISCONTINUED -> 0 (never recommended automatically); negative stock -> 0;
 * enough stock -> 0.
 *
 * RELIABILITY (only what the data allows, no invented precision):
 *   none          no sale in the history
 *   very_limited  fewer than 21 days of history or fewer than 5 days with sales
 *   limited       fewer than 60 days of history or fewer than 15 days with sales
 *   sufficient    otherwise
 *
 * RECENCY: a product that HAS sold but not during the last 28 days
 * (SAFETY_WINDOW_DAYS, the same window the safety stock uses) drops one level
 * (sufficient -> limited, limited -> very_limited; never below very_limited,
 * "none" stays "none") and `noRecentSales` is true: an old history says little
 * about next week once sales have stopped. Only the label changes - the forecast
 * figures, the models and the recommended quantity are untouched.
 *
 * EVALUATION: the test MAE of the model is only meaningful when the test window
 * (the last DEFAULT_TEST_DAYS = 14 days of the series) holds at least one real
 * sale; with an all-zero window, predicting 0 scores a "perfect" MAE of 0. The
 * recommendation then reports `mae: null` / `evaluable: false` ("Non
 * évaluable"). The model choice inside the engine is not affected.
 */

export const SAFETY_Z = 1.28;
export const SAFETY_HORIZON_DAYS = 7;
export const SAFETY_WINDOW_DAYS = 28;
export const SAFETY_MIN_HISTORY_DAYS = 28;
export const SAFETY_MIN_SALE_DAYS = 5;
export const FALLBACK_SAFETY_FRACTION = 0.5;

export type Reliability = "sufficient" | "limited" | "very_limited" | "none";
export type SafetyStockRule = "demand_variability" | "fallback_half_week" | "none";

export type PurchaseRecommendation = {
  productId: string;
  productName: string;
  productStatus: ProductStatus;
  currentStock: number;
  /** false: no StockLevel row exists for this product (counted as 0). */
  stockKnown: boolean;
  /** true when currentStock < 0: no purchase is recommended, the stock must be regularised first. */
  stockRegularizationRequired: boolean;
  forecast1Day: number;
  forecast3Days: number;
  forecast7Days: number;
  safetyStock: number;
  safetyStockRule: SafetyStockRule;
  targetStock: number;
  recommendedPurchaseQuantity: number;
  /** Model that produced the forecast (moving_average when there is no history). */
  model: ModelName | null;
  /** Test MAE of that model (mean absolute error per day); null when it could not be evaluated. */
  mae: number | null;
  reliability: Reliability;
  /** true: the product has sold in the past but not during the last 28 days (reliability lowered by one level). */
  noRecentSales: boolean;
  /**
   * false: the forecast error (`mae`, null then) cannot be assessed - the model was
   * never tested, or the test window (last 14 days) had no real sale.
   */
  evaluable: boolean;
  historyDays: number;
  soldDays: number;
  reason: string;
};

export type RecommendationInput = {
  productId: string;
  productName: string;
  productStatus: ProductStatus;
  /** null = no StockLevel row. */
  currentStock: number | null;
  /** Sums of the daily forecast (unrounded) up to 1, 3 and 7 days. 0 when never sold. */
  forecast1Day: number;
  forecast3Days: number;
  forecast7Days: number;
  /** Model/MAE of the forecast; null when there is no history to forecast from. */
  model: ModelName | null;
  mae: number | null;
  /** Total days of history and days with a sale, over the WHOLE series (step 4: cached counts). */
  historyDays: number;
  soldDays: number;
  /**
   * Daily quantities of the LAST `SAFETY_WINDOW_DAYS` (28) days, oldest
   * first - the only history the safety-stock formula's std-dev needs.
   * Fewer than 28 entries for a product younger than that (never padded with
   * invented zeros - same rule as step 1's densifyProductDailySales). Empty
   * when never sold.
   */
  recentValues: number[];
};

export function assessReliability(historyDays: number, soldDays: number): Reliability {
  if (soldDays === 0) return "none";
  if (historyDays < 21 || soldDays < 5) return "very_limited";
  if (historyDays < 60 || soldDays < 15) return "limited";
  return "sufficient";
}

/** One level lower; "very_limited" and "none" are already the floor of a product that has / never had sales. */
export function lowerReliability(level: Reliability): Reliability {
  if (level === "sufficient") return "limited";
  if (level === "limited") return "very_limited";
  return level;
}

/**
 * True when the product has sold before but nothing in the last 28 days.
 * `recentValues` are the daily quantities of the last 28 days (oldest first).
 * An EMPTY window counts as "no recent sale": on the cached path the window
 * query (queryRecentDailyValues) only returns the products that sold during it,
 * so a product that has a snapshot (it did sell at some point) but no entry is
 * exactly a product without a sale in the last 28 days.
 */
export function hasNoRecentSales(soldDays: number, recentValues: number[]): boolean {
  return soldDays > 0 && !recentValues.some((value) => value > 0);
}

/**
 * The model's test MAE is only an accuracy figure when the test window (the
 * last 14 days) held a real sale. When it did not - an all-zero window, or an
 * empty one (no sale at all in the last 28 days, see hasNoRecentSales) - or
 * when the model was never evaluated (mae null), the forecast is "not
 * evaluable". A recent window of fewer than 14 days (a very young product) is
 * not judged here: there is nothing to compare it with.
 */
export function isForecastEvaluable(mae: number | null, recentValues: number[]): boolean {
  if (mae === null) return false;
  if (recentValues.length === 0) return false;
  if (recentValues.length >= DEFAULT_TEST_DAYS && !recentValues.slice(-DEFAULT_TEST_DAYS).some((value) => value > 0)) {
    return false;
  }
  return true;
}

export function computeSafetyStock(input: {
  historyDays: number;
  soldDays: number;
  forecast7Days: number;
  recentValues: number[];
}): { safetyStock: number; rule: SafetyStockRule } {
  const soldRecently = input.recentValues.some((value) => value > 0);
  if (input.forecast7Days === 0 && !soldRecently) return { safetyStock: 0, rule: "none" };

  if (input.historyDays >= SAFETY_MIN_HISTORY_DAYS && input.soldDays >= SAFETY_MIN_SALE_DAYS) {
    const sigma = stdDev(input.recentValues);
    return { safetyStock: Math.ceil(SAFETY_Z * sigma * Math.sqrt(SAFETY_HORIZON_DAYS)), rule: "demand_variability" };
  }
  return { safetyStock: Math.ceil(FALLBACK_SAFETY_FRACTION * input.forecast7Days), rule: "fallback_half_week" };
}

const RELIABILITY_LABEL: Record<Reliability, string> = {
  sufficient: "historique suffisant",
  limited: "historique limité",
  very_limited: "historique très limité",
  none: "aucune donnée de vente",
};

/**
 * Pure computation for one product - the ONLY place the formula lives. Never
 * called with a `predictions`/full-`history` array directly: the caller
 * (live path below, or the step-4 cached-read path) reduces its own data
 * source to exactly this shape first, so both paths run this identical code.
 */
export function computeRecommendation(input: RecommendationInput): PurchaseRecommendation {
  const stockKnown = input.currentStock !== null;
  const currentStock = input.currentStock ?? 0;
  const { historyDays, soldDays, forecast1Day, forecast3Days, forecast7Days } = input;
  const noRecentSales = hasNoRecentSales(soldDays, input.recentValues);
  const baseReliability = assessReliability(historyDays, soldDays);
  const reliability = noRecentSales ? lowerReliability(baseReliability) : baseReliability;
  const evaluable = isForecastEvaluable(input.mae, input.recentValues);

  const { safetyStock, rule } = computeSafetyStock({
    historyDays,
    soldDays,
    forecast7Days,
    recentValues: input.recentValues,
  });
  const targetStock = forecast7Days + safetyStock;
  const needed = Math.max(0, targetStock - currentStock);

  const active = input.productStatus === "ACTIVE";
  const stockRegularizationRequired = currentStock < 0;
  const recommendedPurchaseQuantity = active && reliability !== "none" && !stockRegularizationRequired ? needed : 0;

  const stockNote = !stockKnown ? " Aucun niveau de stock enregistré : stock considéré à 0." : "";
  const negativeNote = ` Stock négatif (${currentStock}) : à régulariser.`;

  let reason: string;
  if (!active) {
    reason = `Produit ${input.productStatus === "INACTIVE" ? "inactif" : "arrêté"} : aucun achat recommandé automatiquement.`;
    if (stockRegularizationRequired) reason += negativeNote;
  } else if (reliability === "none") {
    reason = "Produit jamais vendu : aucune prévision possible, aucun achat recommandé.";
    if (stockRegularizationRequired) reason += negativeNote;
  } else if (stockRegularizationRequired) {
    reason = `Stock négatif (${currentStock}) : aucun achat automatique n'est recommandé, le stock doit d'abord être régularisé.`;
  } else if (recommendedPurchaseQuantity === 0) {
    reason =
      forecast7Days === 0 && safetyStock === 0
        ? "Aucune vente récente prévue : aucun achat nécessaire."
        : `Le stock actuel (${currentStock}) couvre le stock cible (${targetStock}) : aucun achat nécessaire.`;
  } else {
    reason = `Le stock actuel (${currentStock}) est inférieur au stock cible (${targetStock} = ${forecast7Days} prévus sur 7 jours + ${safetyStock} de sécurité).`;
  }
  reason += stockNote;
  if (active && reliability !== "none") {
    reason += ` Fiabilité : ${RELIABILITY_LABEL[reliability]} (${historyDays} jours, ${soldDays} avec ventes).`;
    if (noRecentSales) reason += " Aucune vente sur les 28 derniers jours : fiabilité réduite.";
  }

  return {
    productId: input.productId,
    productName: input.productName,
    productStatus: input.productStatus,
    currentStock,
    stockKnown,
    stockRegularizationRequired,
    forecast1Day,
    forecast3Days,
    forecast7Days,
    safetyStock,
    safetyStockRule: rule,
    targetStock,
    recommendedPurchaseQuantity,
    model: input.model,
    mae: evaluable ? input.mae : null,
    reliability,
    noRecentSales,
    evaluable,
    historyDays,
    soldDays,
    reason,
  };
}

/** One aggregated query: available stock per product over DEPOT + TRUCK locations of the organisation. */
export async function queryCurrentStockByProduct(db: ForecastDb, organizationId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<Array<{ productId: string; stock: number }>>(Prisma.sql`
    SELECT sl."productId" AS "productId",
           SUM(sl.quantity - sl."reservedQuantity")::int AS stock
    FROM "StockLevel" sl
    JOIN "StockLocation" loc ON loc.id = sl."locationId"
    WHERE sl."organizationId" = ${organizationId}
      AND loc."organizationId" = ${organizationId}
      AND loc.type IN ('DEPOT', 'TRUCK')
    GROUP BY sl."productId"
  `);
  return new Map(rows.map((row) => [row.productId, Number(row.stock)]));
}

export type PurchaseRecommendationOptions = SalesForecastOptions & {
  /** Also list products that never sold (recommendation 0). Default false. */
  includeNeverSold?: boolean;
};

export type PurchaseRecommendationResult = {
  asOf: string;
  recommendations: PurchaseRecommendation[];
  /** step 4: "cache" when a same-day snapshot was used, "live" when the forecast was computed on the spot. */
  source: "cache" | "live";
};

/** Only what queryRecentDailyValues needs from a product row. */
type ProductRow = { id: string; name: string; status: ProductStatus };

/**
 * Live path (no snapshot, or step 4's own fallback): runs the full engine
 * (lib/forecasting/sales-forecast.ts - historical series + chronological
 * evaluation + Random Forest) ONCE, then reduces its output to
 * RecommendationInput per product. Same numbers step 3 always produced.
 */
export async function buildPurchaseRecommendationsLive(
  db: ForecastDb,
  organizationId: string,
  options: PurchaseRecommendationOptions = {},
): Promise<PurchaseRecommendationResult> {
  const forecast = await buildSalesForecast(db, organizationId, { ...options, horizon: 7 });
  const [stockByProduct, products] = await Promise.all([
    queryCurrentStockByProduct(db, organizationId),
    db.product.findMany({ where: { organizationId }, select: { id: true, name: true, status: true } }),
  ]);

  const seriesById = new Map<string, DailySeries>(forecast.series.map((series) => [series.productId, series]));
  const predictionsById = new Map<string, SalesPrediction[]>();
  for (const prediction of forecast.predictions) {
    const list = predictionsById.get(prediction.productId) ?? [];
    list.push(prediction);
    predictionsById.set(prediction.productId, list);
  }

  const recommendations = buildRecommendationList(products, options, stockByProduct, (product) => {
    const series = seriesById.get(product.id);
    if (!series) return null;
    const predictions = predictionsById.get(product.id) ?? [];
    return {
      forecast1Day: sumForecastDays(predictions, 1),
      forecast3Days: sumForecastDays(predictions, 3),
      forecast7Days: sumForecastDays(predictions, 7),
      model: predictions[0]?.model ?? null,
      mae: predictions[0]?.mae ?? null,
      historyDays: series.values.length,
      soldDays: series.values.filter((value) => value > 0).length,
      recentValues: series.values.slice(-SAFETY_WINDOW_DAYS),
    };
  });

  return { asOf: forecast.asOf, recommendations, source: "live" };
}

/**
 * Step 4 cached path: the (fast) forecast figures come from an already-computed
 * snapshot row per product; only the recent 28-day window (for the safety-stock
 * std-dev - NOT the ML forecast) and the current stock are read fresh. No
 * Random Forest, no chronological evaluation, no full-history query: the one
 * SQL aggregation this path runs (queryRecentDailyValues) is bounded to 28
 * days, the same lightweight step-1 aggregation, never the ML pipeline.
 */
export async function buildPurchaseRecommendationsFromSnapshot(
  db: ForecastDb,
  organizationId: string,
  asOf: string,
  snapshotRows: Pick<
    SnapshotRow,
    "productId" | "productName" | "forecast1Day" | "forecast3Days" | "forecast7Days" | "model" | "mae" | "historyDays" | "soldDays"
  >[],
  options: { includeNeverSold?: boolean } = {},
): Promise<PurchaseRecommendationResult> {
  const [stockByProduct, products, recentValuesById] = await Promise.all([
    queryCurrentStockByProduct(db, organizationId),
    db.product.findMany({ where: { organizationId }, select: { id: true, name: true, status: true } }),
    queryRecentDailyValues(db, organizationId, asOf),
  ]);
  const snapshotById = new Map(snapshotRows.map((row) => [row.productId, row]));

  const recommendations = buildRecommendationList(products, options, stockByProduct, (product) => {
    const snapshot = snapshotById.get(product.id);
    if (!snapshot) return null;
    return {
      forecast1Day: snapshot.forecast1Day,
      forecast3Days: snapshot.forecast3Days,
      forecast7Days: snapshot.forecast7Days,
      model: snapshot.model,
      mae: snapshot.mae,
      historyDays: snapshot.historyDays,
      soldDays: snapshot.soldDays,
      recentValues: recentValuesById.get(product.id) ?? [],
    };
  });

  return { asOf, recommendations, source: "cache" };
}

/**
 * Shared product loop: skips a never-sold product unless asked for, sorts the
 * same way in both paths. The current stock is ALWAYS looked up (a never-sold
 * product can still have a StockLevel row - see the "produit jamais vendu"
 * case in the tests), independently of whether a forecast was resolved.
 */
function buildRecommendationList(
  products: ProductRow[],
  options: { includeNeverSold?: boolean },
  stockByProduct: Map<string, number>,
  resolve: (
    product: ProductRow,
  ) => Omit<RecommendationInput, "productId" | "productName" | "productStatus" | "currentStock"> | null,
): PurchaseRecommendation[] {
  const recommendations: PurchaseRecommendation[] = [];
  for (const product of products) {
    const resolved = resolve(product);
    if (!resolved && !options.includeNeverSold) continue;
    recommendations.push(
      computeRecommendation({
        productId: product.id,
        productName: product.name,
        productStatus: product.status,
        currentStock: stockByProduct.has(product.id) ? (stockByProduct.get(product.id) as number) : null,
        forecast1Day: resolved?.forecast1Day ?? 0,
        forecast3Days: resolved?.forecast3Days ?? 0,
        forecast7Days: resolved?.forecast7Days ?? 0,
        model: resolved?.model ?? null,
        mae: resolved?.mae ?? null,
        historyDays: resolved?.historyDays ?? 0,
        soldDays: resolved?.soldDays ?? 0,
        recentValues: resolved?.recentValues ?? [],
      }),
    );
  }
  recommendations.sort(
    (a, b) =>
      b.recommendedPurchaseQuantity - a.recommendedPurchaseQuantity ||
      a.productName.localeCompare(b.productName, "fr") ||
      a.productId.localeCompare(b.productId),
  );
  return recommendations;
}

/**
 * The ONLY extra query the cached path runs: the last `SAFETY_WINDOW_DAYS`
 * (28) days of daily sales, per product - step 1's own aggregation
 * (buildProductDailySalesDataset), bounded to a small window. This is NOT the
 * ML forecast (no evaluation, no Random Forest) - only what
 * computeSafetyStock's std-dev needs, kept fresh independently of the cached
 * forecast so a change in recent demand still adjusts the safety margin.
 */
export async function queryRecentDailyValues(
  db: ForecastDb,
  organizationId: string,
  asOf: string,
): Promise<Map<string, number[]>> {
  const from = new Date(`${asOf}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (SAFETY_WINDOW_DAYS - 1));
  const rows = await buildProductDailySalesDataset(db, organizationId, {
    complete: true,
    from: from.toISOString().slice(0, 10),
    to: asOf,
  });
  const byProduct = new Map<string, number[]>();
  for (const row of rows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push(row.quantitySold);
    byProduct.set(row.productId, list);
  }
  return byProduct;
}

/**
 * Step 4's cache-aware entry point: for the ONE organisation given, tries
 * today's snapshot first, falls back to the live engine ONCE if it is
 * missing. Injectable (no `server-only`, no session) - lib/server/purchase-
 * recommendation.ts's `getPurchaseRecommendations()` is the thin,
 * session-bound wrapper that calls this with the real `prisma` and the
 * organisation from `requireOrganizationUser`. Kept in this module (not a
 * separate file) since it is a direct extension of the two functions above,
 * with no ML logic of its own.
 *
 * A snapshot only ever represents the DEFAULT parameters the cron uses (asOf
 * = yesterday's business day, horizon 7, the default test window) - a caller
 * asking for something else (a specific `asOf`, a custom `testDays`) is never
 * answered from a cache that was never computed for it, straight to the live
 * path instead.
 */
export async function getPurchaseRecommendationsFor(
  db: ForecastDb,
  organizationId: string,
  options: PurchaseRecommendationOptions = {},
): Promise<PurchaseRecommendationResult> {
  if (options.asOf === undefined && options.testDays === undefined) {
    const businessDay = getCurrentBusinessDayParam();
    const snapshotRows = await readSnapshotRows(db, organizationId, businessDay);
    if (snapshotRows.length > 0) {
      const asOf = addDays(businessDay, -1);
      return buildPurchaseRecommendationsFromSnapshot(db, organizationId, asOf, snapshotRows, {
        includeNeverSold: options.includeNeverSold,
      });
    }
  }
  return buildPurchaseRecommendationsLive(db, organizationId, options);
}
