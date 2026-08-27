import { Eye, PackageSearch, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  computeCreditNoteTotals,
} from "@/lib/credit-note-calculations";
import { formatCurrency } from "@/lib/utils";
import { CreditNoteStatusBadge } from "@/components/avoirs/credit-note-status-badge";
import type { CreditNote } from "@/types/credit-note";

type CreditNotesTableProps = {
  creditNotes: CreditNote[];
  onView: (creditNote: CreditNote) => void;
  onDeleteDraft: (creditNoteId: string) => void;
};

export function CreditNotesTable({
  creditNotes,
  onView,
  onDeleteDraft,
}: CreditNotesTableProps) {
  if (creditNotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <PackageSearch
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun avoir ne correspond a ces criteres.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Numero</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Facture</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Origine</TableHead>
          <TableHead className="text-right">Articles</TableHead>
          <TableHead className="text-right">Montant TTC</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {creditNotes.map((creditNote) => {
          const totals = computeCreditNoteTotals(creditNote.lines);
          return (
            <TableRow key={creditNote.id}>
              <TableCell className="font-medium text-foreground">
                {creditNote.number}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(creditNote.returnDate).toLocaleDateString("fr-FR")}
              </TableCell>
              <TableCell>{creditNote.invoiceNumber}</TableCell>
              <TableCell>{creditNote.customerName ?? creditNote.customerId}</TableCell>
              <TableCell className="text-muted-foreground">
                {creditNote.saleOrigin === "camion"
                  ? creditNote.truckLabel ?? "Camion"
                  : "Comptoir"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {totals.itemCount}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatCurrency(totals.totalTTC)}
              </TableCell>
              <TableCell>
                <CreditNoteStatusBadge status={creditNote.status} />
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Voir ${creditNote.number}`}
                    onClick={() => onView(creditNote)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {creditNote.status === "BROUILLON" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Supprimer ${creditNote.number}`}
                      onClick={() => onDeleteDraft(creditNote.id)}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
