/** Shapes shared by the commercial analysis API routes, the server module and the Dashboard sections. */

export type SalesMetric = "quantity" | "revenue" | "margin";
export type SortDirection = "asc" | "desc";

export const SALES_METRICS: readonly SalesMetric[] = ["quantity", "revenue", "margin"];

export type SalesAnalysisFilters = {
  /** A driver id, or "all". */
  driverId: string;
  /** "YYYY-MM". */
  month: string;
  /** A supplier id, "all", or "none" (products without a supplier). */
  supplierId: string;
  metric: SalesMetric;
  sort: SalesMetric;
  direction: SortDirection;
};

/** Money in DH, HT, rounded to the cent (roundMoney) - never TTC. */
export type SalesProductRow = {
  productId: string;
  name: string;
  reference: string;
  supplierId: string | null;
  supplierName: string | null;
  /** Quantity sold net of the quantity returned (validated customer credit notes). */
  quantity: number;
  /** Revenue HT net of discounts (already in the line) and of returns. */
  revenue: number;
  /** Revenue HT net - cost of the net quantity (historical unit cost of each line). */
  margin: number;
};

export type SalesDriverRow = {
  driverId: string;
  driverName: string;
  quantity: number;
  revenue: number;
  margin: number;
  productCount: number;
};

export type SalesTotals = {
  quantity: number;
  revenue: number;
  margin: number;
  /** Products with at least one sale line in the period (for the filters). */
  distinctProducts: number;
};

export type SalesAnalysisDto = {
  filters: SalesAnalysisFilters;
  period: { month: string; label: string; fromDay: string; toDay: string };
  totals: SalesTotals;
  products: SalesProductRow[];
  /** Total number of rows before the display cap. */
  productRowCount: number;
  truncated: boolean;
  /** Per driver (same month / supplier filters) - only when driverId = "all". */
  byDriver: SalesDriverRow[] | null;
  drivers: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  /** Cases the figures cannot attribute reliably - shown instead of being guessed. */
  dataQuality: {
    /** Truck sales of the period with no driver (not in any driver's figures). */
    truckSalesWithoutDriver: { count: number; revenue: number };
    /** Returned lines with no link to a sale line: revenue is netted, the cost cannot be. */
    returnLinesWithoutCost: number;
  };
};

export type CoverageFilters = {
  /** A driver id, or "all". */
  driverId: string;
  /** Monday of the week, "YYYY-MM-DD". */
  week: string;
};

export type CoverageStatus = "BOUGHT" | "NO_PURCHASE";

export type CoverageCustomerRow = {
  customerId: string;
  name: string;
  status: CoverageStatus;
  salesCount: number;
  /** TTC invoiced to this customer by this driver during the week. */
  amount: number;
  /** ISO instant of the last sale of the week, null without purchase. */
  lastPurchaseAt: string | null;
};

export type CoverageSummary = {
  assigned: number;
  buyers: number;
  withoutPurchase: number;
  /** 0-100, one decimal; null when nobody is assigned (never a division by zero). */
  rate: number | null;
};

export type CoverageDriverRow = CoverageSummary & { driverId: string; driverName: string };

export type CoverageDto = {
  filters: CoverageFilters;
  period: { fromDay: string; toDay: string; isCurrentWeek: boolean };
  summary: CoverageSummary;
  /** The portfolio of the selected driver (empty for "all"). */
  customers: CoverageCustomerRow[];
  customersTruncated: boolean;
  /** Per driver - only when driverId = "all". */
  byDriver: CoverageDriverRow[] | null;
  drivers: Array<{ id: string; name: string }>;
  /** Customers served by the driver but outside the driver's portfolio (not in the rate). */
  outsidePortfolio: { customers: number; sales: number };
};
