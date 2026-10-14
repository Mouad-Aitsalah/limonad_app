import type { DailyMarginDto, DailySalesGroupingTotalsDto, DailySalesProductDto } from "@/types/daily-invoice";

/**
 * Lot 3 - « Factures journalières »: sales grouped by product and by the unit
 * price TTC really applied, plus the gross margin HT. Pure (no I/O): the server
 * (lib/server/daily-invoices.ts) only loads the sale lines of the day's scope -
 * the SAME `saleWhere` as the CA total of the page - and every rule below is
 * applied here so it is testable without a database.
 *
 *   Unit price TTC applied = SaleLine.totalTTC / SaleLine.quantity, to the cent
 *                            (the POS stores totalTTC = quantity x net unit TTC,
 *                            line discount included - lib/pos-discount.ts)
 *   Amount of a price      = Σ SaleLine.totalTTC of the lines sold at that price
 *   CA of a product        = Σ SaleLine.totalTTC of its lines
 *   Reconciliation         = Σ products + Σ Sale.roundingAmount = Σ Sale.totalTTC (CA total)
 *
 *   Margin HT              = Σ (SaleLine.totalHT − quantity × SaleLine.unitCostHT)
 *   Markup rate (taux de marque) = Margin HT / CA HT × 100, CA HT = Σ SaleLine.totalHT
 *   both over the lines whose cost is RELIABLE only (same formula as the Dashboard
 *   and the commercial analysis - lib/server/dashboard-bi.ts).
 *
 * Cost reliability of a line (SaleLine.unitCostHT is NOT NULL in the schema, so a
 * cost that was never entered and a real zero cost cannot be told apart):
 *  - "missing"     unitCostHT <= 0: no artificial margin is produced, the line is
 *                  left out of the margin and reported;
 *  - "approximate" line created before the cost snapshot existed (its cost was
 *                  back-filled from the purchase price of the migration day,
 *                  prisma/migrations/20260904130000_add_saleline_unit_cost_ht):
 *                  left out and reported;
 *  - "reliable"    otherwise.
 * Credit notes are not deducted (the page's CA total does not deduct them either).
 */

export const DAILY_MARGIN_ROLES = ["admin"] as const;

/** Only the admin sees a margin (same rule as the purchase price and the commercial analysis). */
export function canSeeDailyMargin(role: string | null | undefined): boolean {
  return Boolean(role) && (DAILY_MARGIN_ROLES as readonly string[]).includes(role as string);
}

export type DailySaleLineInput = {
  productId: string;
  productName: string;
  productReference: string;
  quantity: number;
  totalTTC: number;
  totalHT: number;
  /** Absent when the caller may not see costs (never loaded for those roles). */
  unitCostHT?: number | null;
  createdAt: Date | string;
};

export type MarginLineInput = Pick<DailySaleLineInput, "quantity" | "totalHT" | "unitCostHT" | "createdAt">;

export type CostStatus = "reliable" | "missing" | "approximate";

const cents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

export function classifyLineCost(line: MarginLineInput, reliableSince: Date | null): CostStatus {
  if (line.unitCostHT === null || line.unitCostHT === undefined || !(line.unitCostHT > 0)) return "missing";
  if (reliableSince && new Date(line.createdAt).getTime() < reliableSince.getTime()) return "approximate";
  return "reliable";
}

/** Unit price TTC really applied, in cents (the grouping key - two different prices are never merged). */
export function appliedUnitPriceCents(line: Pick<DailySaleLineInput, "quantity" | "totalTTC">): number {
  return line.quantity > 0 ? Math.round(cents(line.totalTTC) / line.quantity) : cents(line.totalTTC);
}

/** Margin HT and markup rate over the reliable lines; the excluded ones are counted, never estimated. */
export function summarizeMargin(lines: MarginLineInput[], reliableSince: Date | null): DailyMarginDto {
  let marginCents = 0;
  let revenueCents = 0;
  let totalRevenueCents = 0;
  let missingCostLines = 0;
  let approximateCostLines = 0;
  for (const line of lines) {
    const lineRevenue = cents(line.totalHT);
    totalRevenueCents += lineRevenue;
    const status = classifyLineCost(line, reliableSince);
    if (status === "missing") {
      missingCostLines += 1;
      continue;
    }
    if (status === "approximate") {
      approximateCostLines += 1;
      continue;
    }
    revenueCents += lineRevenue;
    marginCents += lineRevenue - line.quantity * cents(line.unitCostHT as number);
  }
  const marginHT = fromCents(marginCents);
  const revenueHT = fromCents(revenueCents);
  return {
    marginHT,
    revenueHT,
    markupRate: revenueCents === 0 ? null : Math.round((marginCents / revenueCents) * 10000) / 100,
    partial: missingCostLines + approximateCostLines > 0,
    totalRevenueHT: fromCents(totalRevenueCents),
    excludedRevenueHT: fromCents(totalRevenueCents - revenueCents),
    missingCostLines,
    approximateCostLines,
  };
}

export type GroupDailySalesOptions = {
  includeMargin: boolean;
  reliableSince: Date | null;
  /** Σ Sale.roundingAmount of the same scope. */
  roundingTotal: number;
  /** Σ Sale.totalTTC of the same scope - the page's CA total. */
  revenueTotal: number;
};

export type DailySalesGrouping = {
  products: DailySalesProductDto[];
  totals: DailySalesGroupingTotalsDto;
  margin?: DailyMarginDto;
};

export function groupDailySales(lines: DailySaleLineInput[], options: GroupDailySalesOptions): DailySalesGrouping {
  const byProduct = new Map<string, { name: string; reference: string; lines: DailySaleLineInput[]; prices: Map<number, { quantity: number; amountCents: number }> }>();
  for (const line of lines) {
    let product = byProduct.get(line.productId);
    if (!product) {
      product = { name: line.productName, reference: line.productReference, lines: [], prices: new Map() };
      byProduct.set(line.productId, product);
    }
    product.lines.push(line);
    const key = appliedUnitPriceCents(line);
    const group = product.prices.get(key) ?? { quantity: 0, amountCents: 0 };
    group.quantity += line.quantity;
    group.amountCents += cents(line.totalTTC);
    product.prices.set(key, group);
  }

  let linesTotalCents = 0;
  let totalQuantity = 0;
  const products: DailySalesProductDto[] = [];
  for (const [productId, product] of byProduct) {
    const priceGroups = [...product.prices.entries()]
      .sort(([a], [b]) => b - a)
      .map(([unitCents, group]) => ({ unitPriceTTC: fromCents(unitCents), quantity: group.quantity, amountTTC: fromCents(group.amountCents) }));
    const productCents = [...product.prices.values()].reduce((sum, group) => sum + group.amountCents, 0);
    const productQuantity = [...product.prices.values()].reduce((sum, group) => sum + group.quantity, 0);
    linesTotalCents += productCents;
    totalQuantity += productQuantity;
    products.push({
      productId,
      name: product.name,
      reference: product.reference,
      priceGroups,
      totalQuantity: productQuantity,
      totalTTC: fromCents(productCents),
      ...(options.includeMargin ? { margin: summarizeMargin(product.lines, options.reliableSince) } : {}),
    });
  }
  products.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.reference.localeCompare(b.reference));

  const roundingCents = cents(options.roundingTotal);
  const revenueCents = cents(options.revenueTotal);
  const gapCents = revenueCents - (linesTotalCents + roundingCents);
  return {
    products,
    totals: {
      productCount: products.length,
      totalQuantity,
      linesTotalTTC: fromCents(linesTotalCents),
      roundingTotal: fromCents(roundingCents),
      revenueTotal: fromCents(revenueCents),
      reconciliationGap: fromCents(gapCents),
      reconciled: Math.abs(gapCents) < 1,
    },
    ...(options.includeMargin ? { margin: summarizeMargin(lines, options.reliableSince) } : {}),
  };
}
