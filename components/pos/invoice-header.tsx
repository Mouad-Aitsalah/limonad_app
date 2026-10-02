type InvoiceHeaderProps = {
  userName: string;
  /** Commercial reference of the invoice being prepared/edited (§5). */
  invoiceLabel?: string;
};

/**
 * Invoice metadata strip (N° Facture / Utilisateur / Date / Heure). Screen
 * display only - the depot / stock-source this sale draws from are still sent
 * to the backend (buildSaleBody) and still printed on the ticket; they were
 * only removed from this on-screen strip. Shown in the POS top bar, next to
 * the network status (desktop, >= lg); hidden on mobile (< lg) so the phone
 * screens keep going straight to products / cart. Type is x1.4 of the former
 * one (12px labels -> 16.8px, 14px values -> 19.6px); it wraps instead of
 * overflowing when the bar is narrow.
 */
export function InvoiceHeader({ userName, invoiceLabel }: InvoiceHeaderProps) {
  const now = new Date();
  const date = now.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const heure = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="hidden flex-wrap gap-x-8 gap-y-1 rounded-2xl border border-border bg-muted/40 px-5 py-2.5 lg:flex">
      <div>
        <p className="text-[16.8px] leading-tight text-muted-foreground">N° Facture</p>
        <p className="text-[19.6px] leading-tight font-semibold text-foreground tabular-nums">{invoiceLabel ?? "-"}</p>
      </div>
      <div>
        <p className="text-[16.8px] leading-tight text-muted-foreground">Utilisateur</p>
        <p className="text-[19.6px] leading-tight font-medium text-foreground">{userName}</p>
      </div>
      <div>
        <p className="text-[16.8px] leading-tight text-muted-foreground">Date</p>
        <p className="text-[19.6px] leading-tight font-medium text-foreground" suppressHydrationWarning>
          {date}
        </p>
      </div>
      <div>
        <p className="text-[16.8px] leading-tight text-muted-foreground">Heure</p>
        <p className="text-[19.6px] leading-tight font-medium text-foreground" suppressHydrationWarning>
          {heure}
        </p>
      </div>
    </div>
  );
}
