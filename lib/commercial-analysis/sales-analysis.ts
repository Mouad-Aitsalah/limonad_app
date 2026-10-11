import { roundMoney } from "@/lib/money";
import type {
  SalesDriverRow,
  SalesMetric,
  SalesProductRow,
  SalesTotals,
  SortDirection,
} from "@/types/commercial-analysis";

/**
 * Calculation rules of « Analyse des ventes » - pure (the SQL in
 * lib/server/commercial-analysis.ts only SUMS per driver and product; every
 * rule below is applied here so it can be tested without a database).
 *
 *   Quantity = quantity sold - quantity returned
 *   Revenue  = SUM(SaleLine.totalHT) - SUM(CreditNoteLine.totalHT)       (HT, discounts are in totalHT)
 *   Cost     = SUM(quantity x SaleLine.unitCostHT) - the same for the returned lines
 *              (unitCostHT is the cost FROZEN on the line when it was sold - never the current purchase price)
 *   Margin   = Revenue - Cost
 *
 * Sales: the project's real-sale perimeter (VALIDATED, PARTIALLY_PAID, PAID, CREDIT,
 * CREDIT_NOTED - not DRAFT, not CANCELLED), dated by Sale.validatedAt. Returns: validated
 * customer credit notes, dated by their OWN validatedAt (the rule of the sales archive's
 * « Total remboursements »), so a sale and its return are never counted twice nor lost.
 */

/** One SQL group: a driver x a product. Sold side and returned side are summed apart. */
export type SalesAggregateRow = {
  driverId: string;
  productId: string;
  soldQuantity: number;
  soldRevenue: number;
  soldCost: number;
  returnedQuantity: number;
  returnedRevenue: number;
  /** Cost of the returned lines that are linked to a sale line (the others have none). */
  returnedCost: number;
  /** Returned lines with no link to a sale line: their revenue is netted but their cost cannot be. */
  returnLinesWithoutCost?: number;
};

export type ProductMeta = {
  name: string;
  reference: string;
  supplierId: string | null;
  supplierName: string | null;
};

/** Rows shown in the products table (the KPIs always cover every row). */
export const SALES_TABLE_ROW_CAP = 500;

type Net = { quantity: number; revenue: number; margin: number };

const ZERO: Net = { quantity: 0, revenue: 0, margin: 0 };

function addRow(total: Net, row: SalesAggregateRow): Net {
  return {
    quantity: total.quantity + row.soldQuantity - row.returnedQuantity,
    revenue: total.revenue + row.soldRevenue - row.returnedRevenue,
    margin: total.margin + (row.soldRevenue - row.soldCost) - (row.returnedRevenue - row.returnedCost),
  };
}

const money = (net: Net): Net => ({ quantity: net.quantity, revenue: roundMoney(net.revenue), margin: roundMoney(net.margin) });

/** One row per product, whatever the number of sale lines / invoices / drivers behind it. */
export function buildProductRows(
  rows: readonly SalesAggregateRow[],
  meta: ReadonlyMap<string, ProductMeta>,
  options: { driverId?: string } = {},
): SalesProductRow[] {
  const byProduct = new Map<string, Net>();
  for (const row of rows) {
    if (options.driverId && options.driverId !== "all" && row.driverId !== options.driverId) continue;
    byProduct.set(row.productId, addRow(byProduct.get(row.productId) ?? ZERO, row));
  }
  return [...byProduct.entries()].map(([productId, net]) => {
    const info = meta.get(productId);
    return {
      productId,
      name: info?.name ?? "Produit inconnu",
      reference: info?.reference ?? "",
      supplierId: info?.supplierId ?? null,
      supplierName: info?.supplierName ?? null,
      ...money(net),
    };
  });
}

/** Totals over every product row; distinct products = products with a sale line in the period. */
export function buildTotals(
  rows: readonly SalesAggregateRow[],
  options: { driverId?: string } = {},
): SalesTotals {
  let net = ZERO;
  const sold = new Set<string>();
  for (const row of rows) {
    if (options.driverId && options.driverId !== "all" && row.driverId !== options.driverId) continue;
    net = addRow(net, row);
    if (row.soldQuantity > 0) sold.add(row.productId);
  }
  return { ...money(net), distinctProducts: sold.size };
}

/** The comparative view: one row per driver (same month / supplier filters, never mixed with the product rows). */
export function buildDriverRows(
  rows: readonly SalesAggregateRow[],
  driverNames: ReadonlyMap<string, string>,
): SalesDriverRow[] {
  const perDriver = new Map<string, { net: Net; products: Set<string> }>();
  for (const row of rows) {
    const entry = perDriver.get(row.driverId) ?? { net: ZERO, products: new Set<string>() };
    entry.net = addRow(entry.net, row);
    if (row.soldQuantity > 0) entry.products.add(row.productId);
    perDriver.set(row.driverId, entry);
  }
  return [...perDriver.entries()].map(([driverId, entry]) => ({
    driverId,
    driverName: driverNames.get(driverId) ?? "Chauffeur inconnu",
    ...money(entry.net),
    productCount: entry.products.size,
  }));
}

/** Stable order: the chosen metric, then the designation, then the id. */
export function sortRows<T extends { quantity: number; revenue: number; margin: number }>(
  rows: readonly T[],
  key: SalesMetric,
  direction: SortDirection,
  tieBreaker: (row: T) => string,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const delta = (a[key] - b[key]) * sign;
    if (delta !== 0) return delta;
    return tieBreaker(a).localeCompare(tieBreaker(b), "fr", { sensitivity: "base" });
  });
}

export const sortProductRows = (rows: readonly SalesProductRow[], key: SalesMetric, direction: SortDirection) =>
  sortRows(rows, key, direction, (row) => `${row.name}\u0000${row.productId}`);

export const sortDriverRows = (rows: readonly SalesDriverRow[], key: SalesMetric, direction: SortDirection) =>
  sortRows(rows, key, direction, (row) => `${row.driverName}\u0000${row.driverId}`);
