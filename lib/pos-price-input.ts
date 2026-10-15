import { roundCurrency } from "@/lib/utils";

/**
 * Typing a unit price in the POS cart. The field keeps what the operator types as TEXT, so it can be
 * empty for a moment ("20" -> "2" -> ""): an empty field is never turned back into the catalogue
 * price, and a zero is a real price. Pure helpers, no React.
 *
 *   ""      -> nothing typed yet: counts as 0 DH for the amounts, shown empty while typing
 *   "0"     -> 0 DH
 *   "15,5"  -> 15.5 DH (comma or dot, at most 2 decimals)
 */

/**
 * Shown when a sale whose whole total is 0 DH is attempted OFFLINE (the server refuses it the same way
 * online - assertSaleHasAmount): saved locally it could never be synchronised.
 */
export const ZERO_TOTAL_SALE_MESSAGE =
  "Le total de la vente doit être supérieur à 0 DH. Ajoutez un article payant ou corrigez les prix.";

/** The price an input text stands for: "" is 0 (not "unknown"), anything unreadable is null. */
export function parsePriceText(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (normalized === "" || normalized === ".") return 0;
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Accepts a keystroke / paste only when the result is still a price being typed; otherwise keeps the previous text. */
export function acceptPriceText(previous: string, next: string): string {
  const cleaned = next.replace(/\s/g, "");
  return parsePriceText(cleaned) === null ? previous : cleaned;
}

/** The text shown for an applied price: no trailing zeros, decimal comma ("20" / "15,5" / "0"). */
export function formatPriceText(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return String(roundCurrency(value)).replace(".", ",");
}

/** The text to show once typing is over: an empty field becomes "0" (the applied price). */
export function settlePriceText(typed: string): string {
  const value = parsePriceText(typed);
  return formatPriceText(value ?? 0);
}

/**
 * The state machine of the price field (components/pos/price-input.tsx only wires it to the input).
 *
 *  - not focused: the field shows the applied price (`value`), whatever it is;
 *  - focused: it shows what is typed (`typed`), which may be "" - the applied price never rewrites it;
 *  - `edited`: the operator typed in this focus session. Only then does a price leave the field: a click
 *    in and out of the field must not turn the catalogue price into a manual one.
 * `emit` is the price to apply (a number, never null/undefined), or null when nothing must change.
 */
export type PriceFieldState = { typed: string | null; edited: boolean };

export const IDLE_PRICE_FIELD: PriceFieldState = { typed: null, edited: false };

export function priceFieldText(state: PriceFieldState, value: number): string {
  return state.typed ?? formatPriceText(value);
}

export function priceFieldFocus(value: number): PriceFieldState {
  return { typed: formatPriceText(value), edited: false };
}

export function priceFieldChange(
  state: PriceFieldState,
  value: number,
  raw: string,
): { state: PriceFieldState; emit: number | null } {
  const shown = priceFieldText(state, value);
  const next = acceptPriceText(shown, raw);
  if (next === shown) return { state, emit: null };
  return { state: { typed: next, edited: true }, emit: parsePriceText(next) ?? 0 };
}

export function priceFieldBlur(
  state: PriceFieldState,
  value: number,
): { state: PriceFieldState; emit: number | null } {
  const emit = state.edited ? (parsePriceText(settlePriceText(priceFieldText(state, value))) ?? 0) : null;
  return { state: IDLE_PRICE_FIELD, emit };
}
