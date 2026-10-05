import { roundMoney } from "@/lib/money";

/**
 * Line totals of a DRIVER POS sale - the single formula shared by the driver
 * cart (components/driver-pos/driver-pos-view.tsx), the server that records
 * the sale (lib/server/driver-sales.ts createDriverSale) and the offline-sync
 * verification (lib/offline/driver-pos/sync-payload.ts), so the amount shown,
 * the amount sent/expected and the amount stored can never drift apart.
 *
 * WHY TTC FIRST. Catalogue prices are stored HT with 2 decimals and the price
 * the driver (and the customer) sees is the TTC one, i.e. roundMoney(HT x
 * (1 + VAT)). The old driver formula multiplied the already-rounded HT by the
 * quantity and only then derived the VAT:
 *     62.50 TTC -> HT 52.08 ; 52.08 x 2 = 104.16 ; VAT 20.83 ; TTC 124.99 (!)
 * because 52.08 is 62.496 TTC, not 62.50, and the half-cent was multiplied by
 * the quantity. Here the line is priced from the displayed TTC unit price:
 *     62.50 x 2 = 125.00 ; HT = 125.00 / 1.2 = 104.17 ; VAT = 125.00 - 104.17
 * (same TTC-first order as the counter POS, lib/pos-discount.ts).
 *
 * DISCOUNT. `discountRate` is still the percentage (0-100) the server stores
 * and the offline sync sends, but the line is priced from the NET UNIT PRICE
 * the driver actually sees, rounded to the cent BEFORE the quantity is applied:
 *     discount per unit = round(unit TTC x rate / 100, 2)   (what the cart shows
 *                         in the "Rem." field, see discountRateToUnitAmount)
 *     net unit TTC      = round(unit TTC - discount per unit, 2)
 *     line total TTC    = round(net unit TTC x quantity, 2)
 * The previous order (percentage of the whole line gross) disagreed with the
 * displayed unit price by up to half a cent PER UNIT: a 1.00 DH discount on an
 * 18.00 DH price is stored as 5.56 %, and 5.56 % of 360.00 is 20.02, i.e. a
 * total of 339.98 while the cart showed 17.00 x 20. With the net unit price
 * first, 18.00 - 1.00 = 17.00 and 17.00 x 20 = 340.00.
 *
 * All steps use roundMoney (decimal arithmetic, half-up) - never raw float
 * multiplication results.
 */
export type DriverLineInput = {
  /** Unit price HT as stored (Product.salePrice) or derived from a verified TTC. */
  unitPriceHT: number;
  /** Unit price TTC exactly as shown to the driver: roundMoney(HT x (1 + VAT)). */
  unitPriceTTC: number;
  /** VAT percentage, e.g. 20. */
  taxRate: number;
  quantity: number;
  /** Line discount, percentage 0-100 (CartLine.discountRate). */
  discountRate: number;
};

export type DriverLineTotals = {
  /** unitPriceHT x quantity, before discount (HT, as persisted-gross reference). */
  grossHT: number;
  /** HT amount of the discount for the whole line (SaleLine.discountAmount), never negative. */
  discountAmount: number;
  totalHT: number;
  taxAmount: number;
  totalTTC: number;
};

export function computeDriverLineTotals({
  unitPriceHT,
  unitPriceTTC,
  taxRate,
  quantity,
  discountRate,
}: DriverLineInput): DriverLineTotals {
  const rate = Number.isFinite(discountRate) ? Math.min(100, Math.max(0, discountRate)) : 0;
  const grossHT = unitPriceHT * quantity;
  const discountUnitAmount = roundMoney(unitPriceTTC * (rate / 100));
  const netUnitPriceTTC = roundMoney(unitPriceTTC - discountUnitAmount);
  const totalTTC = roundMoney(netUnitPriceTTC * quantity);
  const totalHT = roundMoney(totalTTC / (1 + taxRate / 100));
  const taxAmount = roundMoney(totalTTC - totalHT);
  // HT discount of the line. With no discount it is exactly 0: HT x quantity
  // can differ from totalHT by a cent only because of HT rounding, which is
  // not a discount.
  const discountAmount = rate > 0 ? Math.max(0, roundMoney(grossHT - totalHT)) : 0;
  return { grossHT, discountAmount, totalHT, taxAmount, totalTTC };
}
