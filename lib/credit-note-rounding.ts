import Decimal from "decimal.js-light";

import { roundMoney } from "@/lib/money";

/**
 * The share of a sale's commercial rounding (Sale.roundingAmount, see
 * lib/sale-rounding.ts) that a customer credit note gives back.
 *
 * A credit note is computed line by line to the cent (computeLinkedReturnTotals);
 * the rounding of the sale total is returned PROPORTIONALLY to the value
 * returned, with a CUMULATIVE rule so the shares of all the credit notes of a
 * sale add up to the sale's rounding exactly - never more:
 *
 *     value(q)     = sum over the sale lines of  line.totalTTC x q / line.quantity
 *     cumShare(v)  = round2(roundingAmount x v / L)        L = value of the whole sale
 *     share(note)  = cumShare(valueBefore + valueNote) - cumShare(valueBefore)
 *
 * A total return (every quantity of every line, in one or several credit notes)
 * gives back exactly `roundingAmount`: the refund then equals what the customer
 * really paid and no stray cents are left as debt. A partial return gives back a
 * proportional part; the telescoping sum can never exceed the rounding.
 *
 * The value is measured on QUANTITIES (not on the per-line cent amounts of the
 * credit notes), so a return of 1 + 1 + 1 pieces of a line priced 0.50 for 3
 * counts exactly like a return of the 3 pieces at once.
 *
 * Framework-free and pure: shared by the server (creation / validation of the
 * credit note) and the credit-note cart preview, so both show the same amount.
 */

export type SaleLineForReturn = {
  /** SaleLine.totalTTC (cent value, before any rounding of the sale total). */
  totalTTC: number;
  /** SaleLine.quantity (sold). */
  quantity: number;
  /** Quantity already returned by VALIDATED credit notes. */
  alreadyReturnedQuantity: number;
  /** Quantity returned by the credit note being computed (0 for a line it does not return). */
  returningQuantity: number;
};

export type SaleReturnOrigin = {
  /** Sale.roundingAmount (signed; 0 for a sale created before the rounding). */
  saleRoundingAmount: number;
  /** EVERY line of the sale, returned by this note or not. */
  lines: SaleLineForReturn[];
};

function lineValue(line: SaleLineForReturn, quantity: number): Decimal {
  if (line.quantity <= 0 || quantity <= 0) return new Decimal(0);
  const bounded = Math.min(quantity, line.quantity);
  return new Decimal(line.totalTTC).times(bounded).div(line.quantity);
}

function totalValue(origin: SaleReturnOrigin): Decimal {
  return origin.lines.reduce((sum, line) => sum.plus(lineValue(line, line.quantity)), new Decimal(0));
}

function returnedValue(origin: SaleReturnOrigin, includeThisNote: boolean): Decimal {
  return origin.lines.reduce(
    (sum, line) =>
      sum.plus(
        lineValue(line, line.alreadyReturnedQuantity + (includeThisNote ? line.returningQuantity : 0)),
      ),
    new Decimal(0),
  );
}

/** Part of the sale's rounding given back once `returned` of the `total` value is returned. */
function cumulativeShare(roundingAmount: number, returned: Decimal, total: Decimal): Decimal {
  if (roundingAmount === 0 || total.lte(0) || returned.lte(0)) return new Decimal(0);
  if (returned.gte(total)) return new Decimal(roundingAmount);
  return new Decimal(roundingAmount)
    .times(returned)
    .div(total)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** The rounding a credit note gives back for ONE sale (cents, signed like Sale.roundingAmount). */
export function creditNoteRoundingShare(origin: SaleReturnOrigin): number {
  if (origin.saleRoundingAmount === 0) return 0;
  const total = totalValue(origin);
  const before = cumulativeShare(origin.saleRoundingAmount, returnedValue(origin, false), total);
  const after = cumulativeShare(origin.saleRoundingAmount, returnedValue(origin, true), total);
  const share = roundMoney(after.minus(before).toNumber());
  return share === 0 ? 0 : share;
}

/** A credit note spanning several sales: the sum of the shares of each sale. */
export function creditNoteRoundingShareForSales(origins: SaleReturnOrigin[]): number {
  return roundMoney(origins.reduce((sum, origin) => sum + creditNoteRoundingShare(origin), 0));
}

/** The cumulative share ALREADY given back by the validated credit notes of a sale. */
export function roundingShareAlreadyReturned(origin: SaleReturnOrigin): number {
  if (origin.saleRoundingAmount === 0) return 0;
  const share = roundMoney(
    cumulativeShare(origin.saleRoundingAmount, returnedValue(origin, false), totalValue(origin)).toNumber(),
  );
  return share === 0 ? 0 : share;
}

/**
 * The refund ceiling of ONE sale: the validated credit notes already issued
 * (lines + rounding shares) plus this note (lines + share) must not exceed the
 * sale's final total (Sale.totalTTC, what was really due).
 *
 * The tolerance is one cent per sale line: the per-line cent amounts of
 * partial returns are rounded individually (returning 1 + 1 + 1 pieces of a
 * 0.50 line gives 0.17 x 3 = 0.51), a pre-existing cent effect that must never
 * block the legitimate return of the last piece.
 */
export function creditNoteExceedsSaleTotal(input: {
  saleTotalTTC: number;
  /** Sum of the validated credit notes' returned LINES (cent amounts) for this sale. */
  alreadyCreditedLinesTTC: number;
  /** Rounding shares already given back (roundingShareAlreadyReturned). */
  alreadyCreditedRounding: number;
  /** This note's returned lines (cent amounts) for this sale. */
  noteLinesTTC: number;
  /** This note's share for this sale (creditNoteRoundingShare). */
  noteRoundingShare: number;
  lineCount: number;
}): boolean {
  const credited = new Decimal(input.alreadyCreditedLinesTTC)
    .plus(input.alreadyCreditedRounding)
    .plus(input.noteLinesTTC)
    .plus(input.noteRoundingShare);
  const ceiling = new Decimal(input.saleTotalTTC).plus(new Decimal(0.01).times(Math.max(1, input.lineCount)));
  return credited.gt(ceiling);
}
