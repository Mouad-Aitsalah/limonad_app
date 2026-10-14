import { roundMoney } from "@/lib/money";
import type { CoverageCustomerRow, CoverageSummary, CoverageUserRow } from "@/types/commercial-analysis";

/**
 * Rules of « Couverture commerciale » - pure.
 *
 *   Rate = customers of the portfolio with at least one valid sale by its owner during the week
 *          / customers of the portfolio x 100
 *
 * - The denominator is the WHOLE portfolio, visited or not.
 * - A customer counts once per week, however many sales.
 * - A sale only counts for the portfolio of its seller (the user account of the sale's driver, else the
 *   user who recorded it) and only for a customer of that portfolio (customers served outside it are
 *   reported apart, never in the rate).
 * - No customer assigned -> no rate (null), never a division by zero.
 *
 * Portfolio (lib/server/commercial-analysis-core.ts): the ACTIVE customers whose creating driver
 * (Customer.createdByDriverId - the only customer-to-user assignment the data has, the rule the driver POS
 * already uses) is the user's driver profile, existing at the end of the week. A customer belongs to ONE
 * portfolio at most, so the union of several users' portfolios never counts a customer twice. A user without
 * a driver profile has no portfolio (no assignment relation exists for him); the customers created at the
 * office or imported (no creating driver) form the distinct « Non attribués » group, whose buyers are those
 * who bought from anybody during the week. Nothing is ever reassigned.
 */

export type PortfolioCustomer = { customerId: string; name: string; ownerName?: string | null };

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

/** The selected portfolio(s) with each customer's week status. Only portfolio customers appear. */
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
        ownerName: customer.ownerName ?? null,
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

export type CoverageUserSortKey = "rate" | "buyers" | "withoutPurchase";

/** Users without a portfolio (rate null) go last whatever the direction. */
export function sortCoverageUsers(
  rows: readonly CoverageUserRow[],
  key: CoverageUserSortKey,
  direction: "asc" | "desc",
): CoverageUserRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const value = (row: CoverageUserRow) => (key === "rate" ? row.rate : key === "buyers" ? row.buyers : row.withoutPurchase);
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const delta = ((left ?? 0) - (right ?? 0)) * sign;
    return delta || a.userName.localeCompare(b.userName, "fr", { sensitivity: "base" });
  });
}
