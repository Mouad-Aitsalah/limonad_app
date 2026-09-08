import Decimal from "decimal.js-light";

import { roundMoney } from "@/lib/money";

/**
 * DOUBLE_DISCOUNT_HT purchase mode - the single, testable business helper for
 * the "two SUCCESSIVE discounts on a gross HT price" rule.
 *
 * The two discounts are NEVER added together. discount2 always takes the
 * result of discount1 as its base:
 *
 *   priceAfterDiscount1 = roundMoney(grossHT * (1 - discount1/100))
 *   netHT              = priceAfterDiscount1 * (1 - discount2/100)   // kept exact
 *
 * Example (validated spec): grossHT 15, d1 5%, d2 10%
 *   -> priceAfterDiscount1 = 14.25
 *   -> netHT               = 12.825   (displayed rounded: 12.83)
 *   -> qty 10 line HT      = roundMoney(10 * 12.825) = 128.25
 *
 * All arithmetic goes through decimal.js-light / roundMoney - never naive
 * JS float on a money value.
 */

export type DoubleDiscountInput = {
  /** Gross HT unit price (prefilled from Product.purchasePrice, editable per line). */
  grossHT: number;
  /** Discount 1 in %, 0..100. */
  discount1: number;
  /** Discount 2 in %, 0..100. Applied AFTER discount 1. */
  discount2: number;
};

export type DoubleDiscountResult = {
  /** grossHT after discount 1, rounded to 2 decimals (the base for discount 2). */
  priceAfterDiscount1: number;
  /** Unit net HT after both discounts. NOT rounded - callers round for display
   *  and multiply it by the quantity before the final money rounding. */
  netHT: number;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function safeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateDoubleDiscountPrice({
  grossHT,
  discount1,
  discount2,
}: DoubleDiscountInput): DoubleDiscountResult {
  const gross = safeAmount(grossHT);
  const d1 = clampPercent(discount1);
  const d2 = clampPercent(discount2);

  const priceAfterDiscount1 = roundMoney(
    new Decimal(gross).times(new Decimal(100).minus(d1)).div(100).toNumber(),
  );
  const netHT = new Decimal(priceAfterDiscount1)
    .times(new Decimal(100).minus(d2))
    .div(100)
    .toNumber();

  return { priceAfterDiscount1, netHT };
}

export type DoubleDiscountLineInput = DoubleDiscountInput & {
  quantite: number;
  /** Product VAT rate in % (line HT is net-after-both-discounts, VAT is HT-first). */
  taxRate: number;
};

export type DoubleDiscountLineTotals = {
  priceAfterDiscount1: number;
  /** Exact unit net HT (for quantity multiplication). */
  netUnitHT: number;
  /** Unit net HT rounded to 2 decimals (for display: 12.83). */
  netUnitHTDisplay: number;
  /** roundMoney(quantite * netUnitHT). */
  totalHT: number;
  /** roundMoney(totalHT * taxRate / 100). */
  taxAmount: number;
  /** roundMoney(totalHT + taxAmount). */
  totalTTC: number;
};

export function computeDoubleDiscountLine({
  quantite,
  grossHT,
  discount1,
  discount2,
  taxRate,
}: DoubleDiscountLineInput): DoubleDiscountLineTotals {
  const qty = Number.isFinite(quantite) && quantite > 0 ? quantite : 0;
  const rate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  const { priceAfterDiscount1, netHT } = calculateDoubleDiscountPrice({
    grossHT,
    discount1,
    discount2,
  });

  const totalHT = roundMoney(new Decimal(qty).times(netHT).toNumber());
  const taxAmount = roundMoney(
    new Decimal(totalHT).times(rate).div(100).toNumber(),
  );
  const totalTTC = roundMoney(totalHT + taxAmount);

  return {
    priceAfterDiscount1,
    netUnitHT: netHT,
    netUnitHTDisplay: roundMoney(netHT),
    totalHT,
    taxAmount,
    totalTTC,
  };
}

export type DoubleDiscountTotals = {
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
};

/**
 * Draft "Nouvel achat" totals for the DOUBLE_DISCOUNT_HT mode - mirrors the
 * server (lib/server/purchases.ts#createPurchase): each line's net HT is
 * summed, then the aggregate is rounded once (same shape as
 * computeDraftPurchaseTotalsTTC for the classic mode).
 */
export function computeDraftPurchaseTotalsDoubleDiscountHT(
  lines: DoubleDiscountLineInput[],
): DoubleDiscountTotals {
  let totalHT = 0;
  let totalTVA = 0;
  let totalTTC = 0;
  for (const line of lines) {
    const t = computeDoubleDiscountLine(line);
    totalHT += t.totalHT;
    totalTVA += t.taxAmount;
    totalTTC += t.totalTTC;
  }
  return {
    totalHT: roundMoney(totalHT),
    totalTVA: roundMoney(totalTVA),
    totalTTC: roundMoney(totalTTC),
  };
}
