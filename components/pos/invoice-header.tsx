type InvoiceHeaderProps = {
  /** Commercial reference of the invoice being prepared/edited (§5). */
  invoiceLabel?: string;
};

/**
 * Invoice metadata strip of the POS top bar: N° Facture and Heure only, next
 * to the network status (desktop, >= lg); hidden on mobile (< lg) so the
 * phone screens keep going straight to products / cart.
 *
 * Screen display only. The user and the date are deliberately not shown here
 * any more, but nothing else changed: the session user stays in the POS
 * context (ticket "Caisse", sale author), the sale keeps its own dates, and
 * the depot / stock source are still sent to the backend (buildSaleBody) and
 * printed on the ticket. The hour is read at render time, as before. Type is
 * x1.4 of the former one (12px labels -> 16.8px, 14px values -> 19.6px).
 */
export function InvoiceHeader({ invoiceLabel }: InvoiceHeaderProps) {
  const heure = new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      data-testid="pos-invoice-header"
      className="hidden items-center gap-x-5 rounded-2xl border border-border bg-muted/40 px-5 py-2.5 lg:flex"
    >
      <div>
        <p className="text-[16.8px] leading-tight text-muted-foreground">N° Facture</p>
        <p className="text-[19.6px] leading-tight font-semibold text-foreground tabular-nums">{invoiceLabel ?? "-"}</p>
      </div>
      <div className="border-l border-border pl-5">
        <p className="text-[16.8px] leading-tight text-muted-foreground">Heure</p>
        <p className="text-[19.6px] leading-tight font-medium text-foreground tabular-nums" suppressHydrationWarning>
          {heure}
        </p>
      </div>
    </div>
  );
}
