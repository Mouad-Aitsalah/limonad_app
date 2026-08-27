type InvoiceHeaderProps = {
  userName: string;
  depotName: string;
  stockLocationName: string;
};

export function InvoiceHeader({
  userName,
  depotName,
  stockLocationName,
}: InvoiceHeaderProps) {
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
    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm sm:grid-cols-5">
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
      <div>
        <p className="text-xs text-muted-foreground">Dépôt</p>
        <p className="font-medium text-foreground">{depotName}</p>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <p className="text-xs text-muted-foreground">Stock source</p>
        <p className="font-medium text-foreground">{stockLocationName}</p>
      </div>
    </div>
  );
}
