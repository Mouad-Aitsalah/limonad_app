import { formatCurrency } from "@/lib/utils";

/**
 * Discreet "REMISE" tag shown next to an invoice number when a discount was
 * recorded on it (see lib/sale-discount-indicator.ts). It is rendered only
 * from `hasDiscount`, a field the server adds exclusively for the roles that
 * may see it - so a role without it never gets anything to display.
 */
export function InvoiceDiscountBadge({ amountTTC }: { amountTTC?: number }) {
  const label =
    amountTTC !== undefined && amountTTC > 0
      ? `Remise accordée sur cette facture : ${formatCurrency(amountTTC)}`
      : "Remise accordée sur cette facture";
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] leading-none font-semibold tracking-wide text-rose-700 ring-1 ring-rose-200/80"
    >
      REMISE
    </span>
  );
}
