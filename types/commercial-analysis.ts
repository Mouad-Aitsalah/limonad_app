/** Shapes shared by the commercial analysis API routes, the server module and the Dashboard sections. */

export type SalesMetric = "quantity" | "revenue" | "margin";
export type SortDirection = "asc" | "desc";

export const SALES_METRICS: readonly SalesMetric[] = ["quantity", "revenue", "margin"];

/** Supplier filter value for the products that have no supplier (Product.defaultSupplierId IS NULL). */
export const NO_SUPPLIER = "none";
/** Coverage filter value for the customers assigned to nobody (Customer.createdByDriverId IS NULL). */
export const UNASSIGNED = "unassigned";

export type SalesAnalysisFilters = {
  /** Selected sellers (user ids). Empty = every user. The figures are the UNION of the selected users. */
  userIds: string[];
  /** "YYYY-MM". */
  month: string;
  /** Selected supplier ids, and/or NO_SUPPLIER. Empty = every product. */
  supplierIds: string[];
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

/** One seller (user) of the comparison table. */
export type SalesUserRow = {
  userId: string;
  userName: string;
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

export type AnalysisUserOption = { id: string; name: string; isDriver: boolean };

export type SalesAnalysisDto = {
  filters: SalesAnalysisFilters;
  period: { month: string; label: string; fromDay: string; toDay: string };
  totals: SalesTotals;
  products: SalesProductRow[];
  /** Total number of rows before the display cap. */
  productRowCount: number;
  truncated: boolean;
  /** Per seller (same month / supplier filters): the selected users, or every user when none is selected. */
  byUser: SalesUserRow[];
  users: AnalysisUserOption[];
  suppliers: Array<{ id: string; name: string }>;
  /** True when the organisation has products without a supplier (the « Sans fournisseur » option). */
  hasProductsWithoutSupplier: boolean;
  /** Cases worth knowing about - shown instead of being hidden. */
  dataQuality: {
    /** Truck sales of the period with no driver: attributed to the user who recorded them. */
    truckSalesWithoutDriver: { count: number; revenue: number };
    /** Returned lines with no link to a sale line: revenue is netted, the cost cannot be. */
    returnLinesWithoutCost: number;
  };
};

export type CoverageFilters = {
  /** Selected users, and/or UNASSIGNED. Empty = every user (the « Non attribués » stay apart). */
  userIds: string[];
  /** Monday of the week, "YYYY-MM-DD". */
  week: string;
};

export type CoverageStatus = "BOUGHT" | "NO_PURCHASE";

export type CoverageCustomerRow = {
  customerId: string;
  name: string;
  /** The user whose portfolio the customer is in; null = « Non attribués ». */
  ownerName: string | null;
  status: CoverageStatus;
  salesCount: number;
  /** TTC invoiced to this customer during the week (by its portfolio owner; by anybody for an unassigned one). */
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

export type CoverageUserRow = CoverageSummary & { userId: string; userName: string };

export type CoverageDto = {
  filters: CoverageFilters;
  period: { fromDay: string; toDay: string; isCurrentWeek: boolean };
  /** The selected users (union of their portfolios), or every user when none is selected. */
  summary: CoverageSummary;
  /** The customers of the selected portfolios (empty when nothing is selected). */
  customers: CoverageCustomerRow[];
  customersTruncated: boolean;
  /** One row per user: the selected ones, or every relevant user when none is selected. */
  byUser: CoverageUserRow[];
  /** « Non attribués »: customers created at the office / imported, in no user's portfolio - always apart. */
  unassigned: CoverageSummary;
  users: AnalysisUserOption[];
  /** Customers served by the selected users (or anybody) outside their own portfolio (not in the rate). */
  outsidePortfolio: { customers: number; sales: number };
};
