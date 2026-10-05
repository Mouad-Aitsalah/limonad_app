export const APP_CURRENCY_CODE = "MAD";
export const APP_CURRENCY_DISPLAY = "DH";
export const APP_CURRENCY_LOCALE = "fr-MA";

export function formatCurrency(value: number | string): string {
  const numericValue = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numericValue)) {
    return `0,00 ${APP_CURRENCY_DISPLAY}`;
  }

  return new Intl.NumberFormat(APP_CURRENCY_LOCALE, {
    style: "currency",
    currency: APP_CURRENCY_CODE,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(numericValue)
    .replace(APP_CURRENCY_CODE, APP_CURRENCY_DISPLAY)
    .trim();
}

/**
 * An amount with its explicit sign ("+0,25 DH" / "-0,24 DH"), for the commercial
 * rounding line of the carts and documents. ASCII signs only: the same text goes
 * to the thermal printer.
 */
export function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}
