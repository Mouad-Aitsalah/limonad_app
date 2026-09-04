import type { BiGranularity, BiStockSeverity } from "@/lib/server/dashboard-bi";
import type { DirectionPeriodKey } from "@/lib/dashboard-period";

export type DirectionTrend = {
  /** Formatted, e.g. "+12,4 %" / "-5,2 %" / "Stable". */
  value: string;
  direction: "up" | "down" | "neutral";
};

export type DirectionKpi = {
  id: string;
  label: string;
  /** Pre-formatted for direct display (formatCurrency or a plain count). */
  value: string;
  trend?: DirectionTrend;
  /** Small caption under the value, e.g. "Solde actuel" or the
   * negative-stock-count aside - never another KPI's own value. */
  helper?: string;
};

export type DirectionSeriesPoint = { bucket: string; label: string; ca: number; margin: number };

export type DirectionCategoryPoint = {
  category: string;
  ca: number;
  percentage: number;
  unitsSold: number;
  color: string;
};

export type DirectionTopProductRow = {
  productId: string;
  name: string;
  category: string;
  quantity: number;
  ca: string;
  margin: string;
};

export type DirectionTopProducts = {
  byRevenue: DirectionTopProductRow[];
  byMargin: DirectionTopProductRow[];
  byQuantity: DirectionTopProductRow[];
};

export type DirectionStockAlertRow = {
  productId: string;
  name: string;
  reference: string;
  available: number;
  minimumStock: number;
  severity: BiStockSeverity;
};

export type DirectionStockWatch = {
  outOfStockProducts: number;
  lowStockProducts: number;
  negativeStockProducts: number;
  critical: DirectionStockAlertRow[];
};

export type DirectionTopCustomerRow = {
  customerId: string;
  name: string;
  salesCount: number;
  ca: string;
  receivable: string;
};

export type DirectionWatchItem = {
  id: string;
  label: string;
  tone: "neutral" | "warning" | "danger";
};

export type DirectionDashboardDto = {
  period: {
    key: DirectionPeriodKey;
    label: string;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
  };
  kpis: {
    revenue: DirectionKpi;
    grossMargin: DirectionKpi;
    estimatedResult: DirectionKpi;
    customerReceivables: DirectionKpi;
    stockValue: DirectionKpi;
    salesCount: DirectionKpi;
    avgBasket: DirectionKpi;
    purchasesHT: DirectionKpi;
    chargesHT: DirectionKpi;
    activeCustomers: DirectionKpi;
  };
  marginNote: string | null;
  salesEvolution: {
    granularity: BiGranularity;
    points: DirectionSeriesPoint[];
  };
  categoryBreakdown: DirectionCategoryPoint[];
  topProducts: DirectionTopProducts;
  stockWatch: DirectionStockWatch;
  topCustomers: DirectionTopCustomerRow[];
  watchlist: DirectionWatchItem[];
};
