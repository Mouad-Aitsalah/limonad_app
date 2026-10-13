type InvoiceHeaderProps = {
  /** Commercial reference of the invoice being prepared/edited (§5). */
  invoiceLabel?: string;
};

/**
 * "N° Facture" and "Heure" segments of the POS header block
 * (components/pos/pos-header-info.tsx), side by side - a fragment, so the
 * block's vertical separators fall between them.
 *
 * Screen display only. The user and the date are deliberately not shown, but
 * nothing else changed: the session user stays in the POS context (ticket
 * "Caisse", sale author), the sale keeps its own dates, and the invoice
 * number is the POS's own activeInvoiceLabel. The hour is read at render
 * time, as before.
 */
export function InvoiceHeader({ invoiceLabel }: InvoiceHeaderProps) {
  const heure = new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <p data-testid="pos-invoice-number" className="flex items-baseline gap-1.5 px-2 whitespace-nowrap">
        <span className="text-xs text-muted-foreground">N° Facture</span>
        <span className="text-sm font-semibold text-foreground tabular-nums">{invoiceLabel ?? "-"}</span>
      </p>
      <p data-testid="pos-invoice-time" className="flex items-baseline gap-1.5 px-2 whitespace-nowrap">
        <span className="text-xs text-muted-foreground">Heure</span>
        <span className="text-sm font-semibold text-foreground tabular-nums" suppressHydrationWarning>
          {heure}
        </span>
      </p>
    </>
  );
}
