import Decimal from "decimal.js-light";

import { APP_CURRENCY_CODE, APP_CURRENCY_DISPLAY, APP_CURRENCY_LOCALE } from "@/lib/currency";

/**
 * How an amount that falls exactly between two integers is shown on the Dashboard
 * KPI cards: to the EVEN neighbour (339,50 -> 340, 14.718,50 -> 14.718 - the two
 * examples of the brief only agree with this rule). Every other value goes to the
 * nearest integer. Switching to "half up" (14.718,50 -> 14.719) is this one constant:
 * Decimal.ROUND_HALF_UP.
 */
export const DASHBOARD_AMOUNT_ROUNDING = Decimal.ROUND_HALF_EVEN;

/**
 * An amount for a Dashboard KPI card: no decimals ("14.718 DH", "1.548.699 DH",
 * "0 DH"), rounded to the nearest integer FOR DISPLAY ONLY.
 *
 * This is deliberately NOT lib/currency.ts#formatCurrency, which stays at two
 * decimals for every sale, invoice, ticket, credit note, payment and accounting
 * screen. The value itself is never rounded anywhere else: nothing is stored or
 * computed from this string, and the commercial 0,50 DH rounding of the sales is
 * untouched. Same locale, same "DH" and same separators as formatCurrency, so a
 * KPI reads like the rest of the application, only without the cents.
 */
export function formatDashboardAmount(value: number | string): string {
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numericValue)) return `0 ${APP_CURRENCY_DISPLAY}`;

  let rounded = new Decimal(numericValue).toDecimalPlaces(0, DASHBOARD_AMOUNT_ROUNDING).toNumber();
  // A small negative amount (-0,4) rounds to zero: show "0 DH", never "-0 DH".
  if (rounded === 0) rounded = 0;

  return new Intl.NumberFormat(APP_CURRENCY_LOCALE, {
    style: "currency",
    currency: APP_CURRENCY_CODE,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(rounded)
    .replace(APP_CURRENCY_CODE, APP_CURRENCY_DISPLAY)
    .trim();
}
