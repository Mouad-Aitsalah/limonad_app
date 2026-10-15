import { roundCurrency } from "@/lib/utils";

/**
 * Colour of the unit price applied on a POS cart line, against the product's usual price ("prix
 * d'origine") and its purchase price. All amounts TTC, compared to the cent. Display only: nothing
 * here touches a price, a total or the checkout.
 *
 *   "above"    applied > original                      -> green
 *   "between"  purchase < applied < original           -> orange
 *   "below"    0 <= applied <= purchase (or applied = 0) -> red
 *   "neutral"  applied = original, or not enough data  -> usual colour
 *
 * Order of the rules (first match wins):
 *   1. applied = 0                         -> below. A price of zero is always at or under the cost,
 *                                             so it needs no purchase price to be called red.
 *   2. purchase price unknown              -> neutral (no cost is ever invented).
 *   3. original price unknown              -> below if applied <= purchase, else neutral.
 *   4. applied = original                  -> neutral (the usual price, even when it equals the cost).
 *   5. applied <= purchase                 -> below (the cost is a floor, even if the usual price is under it).
 *   6. applied > original                  -> above.
 *   7. otherwise (purchase < applied < original) -> between.
 * When purchase = original there is no orange zone: the price is red, neutral or green.
 */
export type PriceTone = "above" | "between" | "below" | "neutral";

function known(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

export function priceTone(input: {
  applied: number | null | undefined;
  original: number | null | undefined;
  purchase: number | null | undefined;
}): PriceTone {
  if (input.applied == null || !Number.isFinite(input.applied) || input.applied < 0) return "neutral";
  const applied = roundCurrency(input.applied);
  if (applied === 0) return "below";
  if (!known(input.purchase)) return "neutral";
  const purchase = roundCurrency(input.purchase);
  if (!known(input.original)) return applied <= purchase ? "below" : "neutral";
  const original = roundCurrency(input.original);
  if (applied === original) return "neutral";
  if (applied <= purchase) return "below";
  return applied > original ? "above" : "between";
}

/** Tailwind classes of the price (text + border, plus a soft background for red). `null` = leave the usual look. */
export const PRICE_TONE_CLASS: Record<Exclude<PriceTone, "neutral">, string> = {
  above: "border-emerald-500 font-semibold text-emerald-700",
  between: "border-orange-400 font-semibold text-orange-600",
  below: "border-red-400 bg-red-50 font-semibold text-red-700",
};

/** Same colours for a read-only price (no border). */
export const PRICE_TONE_TEXT_CLASS: Record<Exclude<PriceTone, "neutral">, string> = {
  above: "font-semibold text-emerald-700",
  between: "font-semibold text-orange-600",
  below: "font-semibold text-red-700",
};
