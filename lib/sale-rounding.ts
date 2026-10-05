import Decimal from "decimal.js-light";

import { roundMoney } from "@/lib/money";

/**
 * Commercial rounding of the FINAL total of a sale to the nearest 0.50 DH.
 *
 * Only the total to pay is rounded. Unit prices, line totals, the HT and the VAT
 * keep their real cent values; the difference is recorded explicitly:
 *
 *     totalBeforeRounding = subtotalHT + taxAmount
 *     totalTTC            = roundToHalfDirham(totalBeforeRounding)   (amount due)
 *     roundingAmount      = totalTTC - totalBeforeRounding           (signed)
 *
 * so  totalTTC = subtotalHT + taxAmount + roundingAmount  always holds, and the
 * accounting entry stays balanced through a dedicated rounding line instead of
 * a tampered HT / VAT.
 *
 * 339.49 -> 339.50 (+0.01)   339.75 -> 340.00 (+0.25)   340.24 -> 340.00 (-0.24)
 * 339.51 -> 339.50 (-0.01)   339.98 -> 340.00 (+0.02)   340.25 -> 340.50 (+0.25)
 *
 * Decimal arithmetic (never `Math.round(x * 2) / 2` on a binary float), ties
 * round half up / away from zero like lib/money.ts.
 *
 * This is the ONE implementation used by the counter and driver carts, the
 * server (creation and revision), the offline sales and the documents - the
 * amount can therefore never differ between them. Framework-free (no
 * `server-only`): unit-tested without a database.
 */

/**
 * "COMMERCIAL": the rounding rule above (every new sale).
 * "NONE": the legacy cent total - used ONLY by the server for an offline sale
 * that was queued before the rounding existed (it carries no roundingAmount), so
 * it keeps the total its customer was shown. Never reachable from a public API.
 */
export type SaleRoundingMode = "COMMERCIAL" | "NONE";

export const COMMERCIAL_ROUNDING_STEP = 0.5;

/** Nearest multiple of 0.50, exact on the decimal digits of `amount`. */
export function roundToHalfDirham(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new Error("Montant invalide pour l'arrondi commercial.");
  }
  const rounded = new Decimal(amount)
    .div(COMMERCIAL_ROUNDING_STEP)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .times(COMMERCIAL_ROUNDING_STEP)
    .toNumber();
  // normalise -0 to 0
  return rounded === 0 ? 0 : rounded;
}

export type RoundedTotal = {
  totalBeforeRounding: number;
  roundingAmount: number;
  totalTTC: number;
};

/** The final total and the explicit rounding difference for a total before rounding. */
export function applyCommercialRounding(
  totalBeforeRounding: number,
  mode: SaleRoundingMode = "COMMERCIAL",
): RoundedTotal {
  const before = roundMoney(totalBeforeRounding);
  const totalTTC = mode === "NONE" ? before : roundToHalfDirham(before);
  return { totalBeforeRounding: before, roundingAmount: roundMoney(totalTTC - before), totalTTC };
}

/** What the sale total needs from each line (already computed, to the cent). */
export type SaleLineAmounts = {
  totalHT: number;
  taxAmount: number;
  discountAmount?: number;
};

export type SaleTotals = RoundedTotal & {
  subtotalHT: number;
  discountAmount: number;
  taxAmount: number;
};

/**
 * Sale totals from its lines: subtotalHT and taxAmount are the sums of the line
 * values (unchanged), then the rounding is applied to HT + VAT.
 */
export function computeSaleTotals(
  lines: SaleLineAmounts[],
  mode: SaleRoundingMode = "COMMERCIAL",
): SaleTotals {
  const subtotalHT = roundMoney(lines.reduce((sum, line) => sum + line.totalHT, 0));
  const discountAmount = roundMoney(lines.reduce((sum, line) => sum + (line.discountAmount ?? 0), 0));
  const taxAmount = roundMoney(lines.reduce((sum, line) => sum + line.taxAmount, 0));
  return {
    subtotalHT,
    discountAmount,
    taxAmount,
    ...applyCommercialRounding(roundMoney(subtotalHT + taxAmount), mode),
  };
}
