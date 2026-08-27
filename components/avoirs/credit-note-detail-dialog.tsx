import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  computeCreditNoteLineTotals,
  computeCreditNoteTotals,
  creditNoteReasonLabels,
} from "@/lib/credit-note-calculations";
import { formatCurrency } from "@/lib/utils";
import { CreditNoteStatusBadge } from "@/components/avoirs/credit-note-status-badge";
import type { CreditNote } from "@/types/credit-note";

type CreditNoteDetailDialogProps = {
  creditNote: CreditNote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreditNoteDetailDialog({
  creditNote,
  open,
  onOpenChange,
}: CreditNoteDetailDialogProps) {
  const totals = creditNote ? computeCreditNoteTotals(creditNote.lines) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        {creditNote && totals && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">
                  Avoir {creditNote.number}
                </DialogTitle>
                <CreditNoteStatusBadge status={creditNote.status} />
              </div>
              <DialogDescription>
                Detail du retour marchandise et de la destination stock.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
              <div className="grid gap-4 rounded-2xl border border-border bg-muted/40 p-4 sm:grid-cols-3">
                <Info label="Facture" value={creditNote.invoiceNumber} />
                <Info
                  label="Client"
                  value={creditNote.customerName ?? creditNote.customerId}
                />
                <Info
                  label="Origine"
                  value={
                    creditNote.saleOrigin === "camion"
                      ? creditNote.truckLabel ?? "Camion"
                      : "Comptoir"
                  }
                />
                <Info
                  label="Motif"
                  value={creditNoteReasonLabels[creditNote.reason]}
                />
                <Info
                  label="Stock destination"
                  value={
                    creditNote.stockDestinationLocationName ??
                    creditNote.stockDestinationLocationId
                  }
                />
                <Info
                  label="Date retour"
                  value={new Date(creditNote.returnDate).toLocaleDateString("fr-FR")}
                />
                <Info label="Cree par" value={creditNote.createdBy} />
                <Info
                  label="Valide par"
                  value={creditNote.validatedBy ?? "Non valide"}
                />
                <Info
                  label="Date validation"
                  value={
                    creditNote.validatedAt
                      ? new Date(creditNote.validatedAt).toLocaleDateString("fr-FR")
                      : "Non valide"
                  }
                />
              </div>

              {creditNote.comment && (
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-xs text-muted-foreground">Commentaire</p>
                  <p className="mt-1 text-sm text-foreground">
                    {creditNote.comment}
                  </p>
                </div>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="text-right">Quantite</TableHead>
                    <TableHead className="text-right">Prix unit.</TableHead>
                    <TableHead className="text-right">Remise</TableHead>
                    <TableHead className="text-right">TVA</TableHead>
                    <TableHead className="text-right">Total TTC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditNote.lines.map((line) => {
                    const lineTotals = computeCreditNoteLineTotals(line);
                    return (
                      <TableRow key={line.id ?? `${line.productId}-${line.saleLineId}`}>
                        <TableCell>
                          <div className="font-medium text-foreground">
                            {line.productName ?? "Produit inconnu"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {line.productReference ?? line.productId}
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
                          {formatCurrency(lineTotals.taxAmount)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(lineTotals.totalTTC)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <Separator />

              <div className="ml-auto max-w-xs space-y-2">
                <SummaryLine label="Total HT" value={totals.totalHT} />
                <SummaryLine label="TVA" value={totals.totalTVA} />
                <SummaryLine label="Total TTC" value={totals.totalTTC} strong />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value ?? "-"}</p>
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
