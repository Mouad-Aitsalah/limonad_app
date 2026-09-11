/**
 * POS line discount - DH per unit, taken off the unit's TTC price (the
 * price the customer actually sees and pays), never a percentage. Shared
 * verbatim between the POS cart (live preview, both counter and driver) and
 * the server (creation, revision) so the two never compute a different
 * total for the same input - see the "remise en DH" chantier.
 *
 * SaleLine keeps its two historical columns unchanged:
 *  - `discountAmount` (HT, existing column) stays THE authoritative stored
 *    discount for this line - reused, never duplicated with a second
 *    concurrent amount field.
 *  - `discountRate` (%, existing column) is still populated, as the closest
 *    percentage equivalent, purely so the one remaining reader that
 *    interprets it as a rate (a customer return against this line - see
 *    lib/server/credit-notes.ts) keeps producing a close, real result
 *    instead of silently ignoring the discount. Every POS-owned display
 *    (cart, print, revision reload, invoice detail) ignores discountRate
 *    entirely and reconstructs the exact typed DH amount instead, via
 *    `reconstructDiscountUnitAmount` below - exact for a line created by
 *    this DH flow, and a faithful DH reading of an old % line.
 *
 * No schema change: both columns already existed before this feature.
 */
import { roundMoney } from "@/lib/money";

export type DiscountedLineInput = {
  /** Unit price excl. tax (the catalogue price, or a manual override). */
  unitPriceHT: number;
  /** VAT percentage, e.g. 20. */
  taxRate: number;
  quantity: number;
  /** DH taken off the unit's TTC price - the POS "Rem." field, as typed. */
  discountUnitAmount: number;
};

export type DiscountedLineTotals = {
  /** Clamped to [0, unitPriceTTC] - never negative, never more than the
   * unit itself is worth. */
  discountUnitAmount: number;
  /** HT total discount for the whole line (existing SaleLine.discountAmount). */
  discountAmount: number;
  /** Best-effort %-of-HT equivalent (existing SaleLine.discountRate) - see
   * this module's doc comment for who still reads it and why. */
  discountRate: number;
  totalHT: number;
  taxAmount: number;
  totalTTC: number;
};

/** Unit TTC price, exactly how the POS cart already derives it (catalogue/override HT * (1 + taxRate/100)). */
export function unitPriceTTCFromHT(unitPriceHT: number, taxRate: number): number {
  return roundMoney(unitPriceHT * (1 + taxRate / 100));
}

export function computeDiscountedLineTotals({
  unitPriceHT,
  taxRate,
  quantity,
  discountUnitAmount,
}: DiscountedLineInput): DiscountedLineTotals {
  const unitPriceTTC = unitPriceTTCFromHT(unitPriceHT, taxRate);
  // Never negative, never more than the unit's own TTC price (a "-30 DH net
  // price" can never happen, by construction rather than by a downstream check).
  const clampedDiscountUnitAmount = Math.min(
    Math.max(0, Number.isFinite(discountUnitAmount) ? discountUnitAmount : 0),
    unitPriceTTC,
  );
  const netUnitPriceTTC = roundMoney(unitPriceTTC - clampedDiscountUnitAmount);
  const totalTTC = roundMoney(quantity * netUnitPriceTTC);
  const totalHT = roundMoney(totalTTC / (1 + taxRate / 100));
  const taxAmount = roundMoney(totalTTC - totalHT);
  const grossHT = unitPriceHT * quantity;
  const discountAmount = roundMoney(grossHT - totalHT);
  const discountRate =
    grossHT > 0 ? Math.min(100, roundMoney((discountAmount / grossHT) * 100)) : 0;

  return {
    discountUnitAmount: clampedDiscountUnitAmount,
    discountAmount,
    discountRate,
    totalHT,
    taxAmount,
    totalTTC,
  };
}

/**
 * Inverse of the above: given a persisted (or in-progress) line's totalTTC,
 * reconstructs the DH-per-unit discount that produced it - exact for a line
 * this module computed, and a faithful DH reading of a historical
 * percentage-discounted line (which also always had a correct, real
 * totalTTC, regardless of how it was originally entered).
 */
/**
 * A LINKED credit-note line's exact totals, derived from the original
 * SaleLine's own real totalTTC/quantity rather than from its rounded
 * discountRate % - see lib/server/credit-notes.ts's "remise DH -
 * corriger les avoirs" chantier. Shared here (isomorphic, no
 * "server-only") so the /avoirs cart preview shows the exact same number
 * the server will actually persist, never a rounded-% approximation.
 */
export function computeLinkedReturnTotals({
  taxRate,
  originalQuantity,
  originalTotalTTC,
  quantityReturned,
}: {
  taxRate: number;
  originalQuantity: number;
  originalTotalTTC: number;
  quantityReturned: number;
}): { totalHT: number; taxAmount: number; totalTTC: number } {
  const totalTTC =
    quantityReturned === originalQuantity
      ? roundMoney(originalTotalTTC)
      : roundMoney(quantityReturned * (originalTotalTTC / originalQuantity));
  const totalHT = roundMoney(totalTTC / (1 + taxRate / 100));
  const taxAmount = roundMoney(totalTTC - totalHT);
  return { totalHT, taxAmount, totalTTC };
}

export function reconstructDiscountUnitAmount({
  unitPriceHT,
  taxRate,
  quantity,
  totalTTC,
}: {
  unitPriceHT: number;
  taxRate: number;
  quantity: number;
  totalTTC: number;
}): number {
  if (quantity <= 0) return 0;
  const unitPriceTTC = unitPriceTTCFromHT(unitPriceHT, taxRate);
  const netUnitPriceTTC = totalTTC / quantity;
  return Math.max(0, roundMoney(unitPriceTTC - netUnitPriceTTC));
}
