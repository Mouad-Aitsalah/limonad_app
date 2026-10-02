import { computePriceTTC } from "@/lib/product-pricing";
import { roundCurrency } from "@/lib/utils";

/**
 * Below-cost alert helpers for the counter POS cart (display only: nothing
 * here touches a price, a total or the checkout, and a sale is never blocked).
 */

/** Purchase price TTC of a product, or null when it is unknown. */
export function purchasePriceTTC(
  purchasePriceHT: number | null | undefined,
  taxRate: number,
): number | null {
  if (purchasePriceHT == null || !Number.isFinite(purchasePriceHT) || purchasePriceHT < 0) {
    return null;
  }
  if (!Number.isFinite(taxRate)) return null;
  return computePriceTTC(purchasePriceHT, taxRate);
}

/**
 * True when the unit price TTC typed in the cart is STRICTLY below the
 * product's purchase price TTC. Equal or higher -> false. Unknown purchase
 * price (null / undefined / not finite) -> false, so no alert is ever shown
 * without data.
 */
export function isSellingBelowCost(
  unitPriceTTC: number,
  purchaseTTC: number | null | undefined,
): boolean {
  if (purchaseTTC == null || !Number.isFinite(purchaseTTC)) return false;
  if (!Number.isFinite(unitPriceTTC)) return false;
  return roundCurrency(unitPriceTTC) < roundCurrency(purchaseTTC);
}
