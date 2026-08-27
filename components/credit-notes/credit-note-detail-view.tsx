import { CreditNoteStatusBadge } from "@/components/avoirs/credit-note-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { creditNoteReasonLabels } from "@/lib/credit-note-calculations";
import { formatCurrency } from "@/lib/utils";
import type { CreditNote } from "@/types/credit-note";

type CreditNoteDetailViewProps = {
  creditNote: CreditNote;
};

export function CreditNoteDetailView({ creditNote }: CreditNoteDetailViewProps) {
  const totalHT = creditNote.lines.reduce((sum, line) => sum + (line.totalHT ?? 0), 0);
  const taxAmount = creditNote.lines.reduce((sum, line) => sum + (line.taxAmount ?? 0), 0);
  const totalTTC = creditNote.lines.reduce((sum, line) => sum + (line.totalTTC ?? 0), 0);
  const isSupplier = creditNote.partyType === "fournisseur";
  const partnerLabel = isSupplier ? "Fournisseur" : "Client";
  const partnerValue = isSupplier
    ? creditNote.supplierName ?? creditNote.supplierId ?? "-"
    : creditNote.customerName ?? creditNote.customerId ?? "-";
  const locationLabel = isSupplier ? "Stock source" : "Destination";
  const locationValue = isSupplier
    ? creditNote.stockSourceLocationName ?? creditNote.stockSourceLocationId ?? "-"
    : creditNote.stockDestinationLocationName ?? creditNote.stockDestinationLocationId ?? "-";
  const detailDescription = isSupplier
    ? "Detail du retour fournisseur et de la sortie de stock."
    : "Detail du retour marchandise et reintegration en stock.";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {creditNote.number}
          </h1>
          <p className="text-sm text-muted-foreground">{detailDescription}</p>
        </div>
        <CreditNoteStatusBadge status={creditNote.status} />
      </div>

      <div className="grid gap-4 rounded-2xl border border-border bg-muted/30 p-4 md:grid-cols-3">
        <Info label={partnerLabel} value={partnerValue} />
        <Info label="Utilisateur" value={creditNote.createdBy} />
        <Info
          label="Date"
          value={new Date(creditNote.returnDate).toLocaleDateString("fr-FR")}
        />
        <Info
          label="Origine"
          value={creditNote.origin === "retour_manuel" ? "Retour manuel" : "Facture"}
        />
        <Info
          label="Source"
          value={
            isSupplier
              ? creditNote.supplierCode ?? creditNote.sourceLabel ?? "-"
              : creditNote.sourceLabel ?? creditNote.invoiceNumber ?? "-"
          }
        />
        <Info label={locationLabel} value={locationValue} />
        <Info label="Motif" value={creditNoteReasonLabels[creditNote.reason]} />
        <Info label="Valide par" value={creditNote.validatedBy ?? "Non valide"} />
        <Info
          label="Date validation"
          value={
            creditNote.validatedAt
              ? new Date(creditNote.validatedAt).toLocaleDateString("fr-FR")
              : "Non valide"
          }
        />
      </div>

      <div className="rounded-2xl border border-border p-4">
        <p className="text-xs text-muted-foreground">Commentaire / justification</p>
        <p className="mt-1 text-sm text-foreground">
          {creditNote.comment || "Aucune justification fournie."}
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produit</TableHead>
              <TableHead className="text-right">Quantite</TableHead>
              <TableHead className="text-right">Prix reprise</TableHead>
              <TableHead className="text-right">Remise</TableHead>
              <TableHead className="text-right">TVA</TableHead>
              <TableHead className="text-right">Total TTC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creditNote.lines.map((line) => (
              <TableRow key={line.id ?? `${line.productId}-${line.saleLineId ?? "manual"}`}>
                <TableCell>
                  <div className="font-medium text-foreground">
                    {line.productName ?? line.productId}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {line.productReference ?? "-"}
                    {line.invoiceNumber ? ` - ${line.invoiceNumber}` : ""}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.quantityReturned}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(line.unitPrice)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.discountPercent}%
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(line.taxAmount ?? 0)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCurrency(line.totalTTC ?? 0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-border p-4">
          <p className="text-sm font-medium text-foreground">Mouvements de stock</p>
          {creditNote.stockMovements && creditNote.stockMovements.length > 0 ? (
            <div className="mt-3 space-y-3">
              {creditNote.stockMovements.map((movement) => (
                <div
                  key={movement.id}
                  className="rounded-xl border border-border bg-muted/20 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {movement.movementNumber}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(movement.createdAt).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {movement.type} - quantite {movement.quantity}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Source {movement.sourceLocationName ?? "-"} | Destination{" "}
                    {movement.destinationLocationName ?? "-"} | {movement.status}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Aucun mouvement de stock associe.
            </p>
          )}
        </div>

        <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-4">
          <SummaryLine label="Sous-total HT" value={totalHT} />
          <SummaryLine label="TVA" value={taxAmount} />
          <SummaryLine label="Total TTC" value={totalTTC} />
          <SummaryLine label="Montant de l'avoir" value={totalTTC} strong />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "flex items-center justify-between text-base font-semibold"
          : "flex items-center justify-between text-sm"
      }
    >
      <span className={strong ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      <span
        className={
          strong
            ? "tabular-nums text-emerald-700"
            : "tabular-nums text-foreground"
        }
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}
