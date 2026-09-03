/**
 * Shared POS stock badge styling (counter + driver product cards).
 *
 * Negative sales are allowed, so stock <= 0 never disables "Ajouter" - it
 * is only ever a visual signal:
 *   > 0   normal / green
 *   === 0 red
 *   < 0   red, stronger, with a warning glyph
 */
export type PosStockTone = {
  /** e.g. "Stock 8", "Stock 0", "⚠ Stock -3" */
  label: (quantity: number) => string;
  /** tailwind classes for the stock text */
  textClassName: string;
  /** true when the value should stand out (0 or negative) */
  alert: boolean;
};

export function posStockTone(quantity: number): PosStockTone {
  if (quantity > 0) {
    return {
      label: (q) => `Stock ${q}`,
      textClassName: "text-muted-foreground",
      alert: false,
    };
  }
  if (quantity === 0) {
    return {
      label: () => "Stock 0",
      textClassName: "font-semibold text-red-600",
      alert: true,
    };
  }
  return {
    label: (q) => `⚠ Stock ${q}`,
    textClassName: "font-bold text-red-700",
    alert: true,
  };
}
