type InvoiceHeaderProps = {
  userName: string;
  /** Commercial reference of the invoice being prepared/edited (§5). */
  invoiceLabel?: string;
};

/**
 * Cart-header metadata strip. Screen display only - the depot / stock-source
 * this sale draws from are still sent to the backend (buildSaleBody) and
 * still printed on the ticket; they were only removed from this on-screen
 * strip. The whole strip is hidden on mobile (< lg) so the phone cart goes
 * straight to Client / N° client / Mode de règlement / panier.
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
    <div className="hidden gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm lg:grid lg:grid-cols-4">
      <div>
        <p className="text-xs text-muted-foreground">N° Facture</p>
        <p className="font-semibold text-foreground tabular-nums">{invoiceLabel ?? "-"}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Utilisateur</p>
        <p className="font-medium text-foreground">{userName}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Date</p>
        <p className="font-medium text-foreground" suppressHydrationWarning>
          {date}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Heure</p>
        <p className="font-medium text-foreground" suppressHydrationWarning>
          {heure}
        </p>
      </div>
    </div>
  );
}
