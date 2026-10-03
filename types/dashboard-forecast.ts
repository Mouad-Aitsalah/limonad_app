/**
 * DTO of the dashboard section "Intelligence & Prévisions IA". Every figure
 * comes from the forecast engine (lib/forecasting) and the live stock / prices
 * - nothing here is ever a placeholder value.
 */

export type ForecastReliability = "sufficient" | "limited" | "very_limited" | "none";

/** Overall quality of the forecast, shown as a banner. "insufficient": no product has enough history. */
export type ForecastQuality = "sufficient" | "limited" | "insufficient";

export type DashboardForecastRow = {
  productId: string;
  reference: string;
  name: string;
  currentStock: number;
  /** Units forecast over the next 7 days (rounded once, from the unrounded daily sums). */
  forecast7Days: number;
  /** Consultative purchase quantity: max(0, forecast + safety stock - available stock). */
  recommendedQuantity: number;
  reliability: ForecastReliability;
  /** Mean absolute error of the model (units per day); null = "Non évaluable" (see `evaluable`). */
  mae: number | null;
  /** false: never tested, or no real sale in the 14-day test window - the accuracy cannot be judged. */
  evaluable: boolean;
  /** true: sold in the past but not during the last 28 days (reliability lowered by one level). */
  noRecentSales: boolean;
  /** Last business day with a sale ("YYYY-MM-DD"), when known. */
  lastSaleDate: string | null;
  /** Complete days without sale since then, up to the forecast reference day; null when unknown. */
  daysSinceLastSale: number | null;
  /** Negative stock: no purchase is recommended, the stock must be regularised first. */
  stockRegularizationRequired: boolean;
  /** Plain-language explanation produced by the recommendation engine. */
  reason: string;
};

export type DashboardForecastDailyPoint = {
  /** "YYYY-MM-DD" */
  date: string;
  /** Units forecast for the whole catalogue that day (rounded). */
  quantity: number;
};

/** Explains an all-zero forecast that comes from missing recent sales (history exists). */
export type DashboardForecastNoRecentSales = {
  /** Complete days without any sale (catalogue-wide, since the latest sale); null when unknown. */
  daysWithoutSale: number | null;
  /** Latest sale of the catalogue ("YYYY-MM-DD"); null when unknown. */
  lastSaleDate: string | null;
};

export type DashboardForecastReady = {
  status: "ready";
  /** Business day of the snapshot used ("YYYY-MM-DD"). */
  businessDay: string;
  /** false: today's forecast was not computed yet, the latest earlier one is shown. */
  isCurrent: boolean;
  /** ISO instant the forecast was computed; null when the database does not store it yet. */
  computedAt: string | null;
  /** Units forecast over the next 7 days, ACTIVE products. */
  totalUnits7Days: number;
  /** Forecast revenue TTC: forecast units x the product's current catalogue price TTC. */
  revenue7Days: number;
  /** null: the per-day detail is not stored for this snapshot (computed before the column existed). */
  daily: DashboardForecastDailyPoint[] | null;
  rows: DashboardForecastRow[];
  /** Rows not shown in `rows` (the list is capped). */
  hiddenRowCount: number;
  /** Number of products by reliability level. */
  reliabilityCounts: Record<ForecastReliability, number>;
  quality: ForecastQuality;
  /** Products with a purchase recommended (> 0). */
  toOrderCount: number;
  /** Products at negative stock, to regularise before any purchase. */
  negativeStockCount: number;
  /** Set when the forecast is 0 units because nothing sold recently, with the days / date of the last sale. */
  noRecentSales: DashboardForecastNoRecentSales | null;
};

export type DashboardForecastEmpty = {
  status: "empty";
  /** no_snapshot: the daily computation has not produced anything yet. no_products: a snapshot exists but holds no active product with sales. */
  reason: "no_snapshot" | "no_products";
};

export type DashboardForecastError = {
  status: "error";
  message: string;
};

export type DashboardForecastDto = DashboardForecastReady | DashboardForecastEmpty | DashboardForecastError;
