import { roundMoney } from "@/lib/money";
import type { CoverageCustomerRow, CoverageDriverRow, CoverageSummary } from "@/types/commercial-analysis";

/**
 * Rules of « Couverture commerciale » - pure.
 *
 *   Rate = customers of the portfolio with at least one valid sale by the driver during the week
 *          / customers of the portfolio x 100
 *
 * - The denominator is the WHOLE portfolio, visited or not.
 * - A customer counts once per week, however many sales.
 * - A sale only counts for the portfolio of the driver who made it (Sale.driverId) and only for a customer
 *   of that portfolio (customers served outside it are reported apart, never in the rate).
 * - No customer assigned -> no rate (null), never a division by zero.
 *
 * Portfolio (lib/server/commercial-analysis.ts): the ACTIVE customers created by the driver
 * (Customer.createdByDriverId - the rule the driver POS already uses) that existed at the end of the week.
 * The data has no assignment history: a customer belongs to ONE driver (its creator), so it can never be in two
 * portfolios, and a customer is never moved retroactively.
 */

export type PortfolioCustomer = { customerId: string; name: string };

export type WeekPurchase = {
  customerId: string;
  salesCount: number;
  /** TTC. */
  amount: number;
  lastPurchaseAt: Date | null;
};

/** Percentage with one decimal; null without a denominator. */
export function coverageRate(assigned: number, buyers: number): number | null {
  if (assigned <= 0) return null;
  return Math.round((buyers / assigned) * 1000) / 10;
}

export function summarize(assigned: number, buyers: number): CoverageSummary {
  const safeBuyers = Math.min(Math.max(buyers, 0), Math.max(assigned, 0));
  return {
    assigned,
    buyers: safeBuyers,
    withoutPurchase: Math.max(assigned - safeBuyers, 0),
    rate: coverageRate(assigned, safeBuyers),
  };
}

/** The portfolio of ONE driver with each customer's week status. Only portfolio customers appear. */
export function buildCustomerRows(
  portfolio: readonly PortfolioCustomer[],
  purchases: ReadonlyMap<string, WeekPurchase>,
): CoverageCustomerRow[] {
  return portfolio
    .map((customer) => {
      const purchase = purchases.get(customer.customerId);
      const bought = Boolean(purchase && purchase.salesCount > 0);
      return {
        customerId: customer.customerId,
        name: customer.name,
        status: bought ? ("BOUGHT" as const) : ("NO_PURCHASE" as const),
        salesCount: bought ? purchase!.salesCount : 0,
        amount: bought ? roundMoney(purchase!.amount) : 0,
        lastPurchaseAt: bought && purchase!.lastPurchaseAt ? purchase!.lastPurchaseAt.toISOString() : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.customerId.localeCompare(b.customerId));
}

export function summarizeCustomerRows(rows: readonly CoverageCustomerRow[]): CoverageSummary {
  return summarize(rows.length, rows.filter((row) => row.status === "BOUGHT").length);
}

export type CoverageDriverSortKey = "rate" | "buyers" | "withoutPurchase";

/** Drivers without a portfolio (rate null) go last whatever the direction. */
export function sortCoverageDrivers(
  rows: readonly CoverageDriverRow[],
  key: CoverageDriverSortKey,
  direction: "asc" | "desc",
): CoverageDriverRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const value = (row: CoverageDriverRow) => (key === "rate" ? row.rate : key === "buyers" ? row.buyers : row.withoutPurchase);
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const delta = ((left ?? 0) - (right ?? 0)) * sign;
    return delta || a.driverName.localeCompare(b.driverName, "fr", { sensitivity: "base" });
  });
}
