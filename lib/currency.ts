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
