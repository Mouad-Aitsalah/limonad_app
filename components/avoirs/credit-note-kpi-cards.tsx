import { FileCheck2, FileClock, Files, ReceiptText } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { CreditNote } from "@/types/credit-note";

export function CreditNoteKpiCards({ creditNotes }: { creditNotes: CreditNote[] }) {
  const totalAmount = creditNotes.reduce(
    (sum, note) =>
      sum +
      note.lines.reduce((lineSum, line) => {
        const totalHT = line.unitPrice * line.quantityReturned;
        const taxAmount = totalHT * (line.taxRate / 100);
        return lineSum + totalHT + taxAmount;
      }, 0),
    0,
  );
  const draftCount = creditNotes.filter((note) => note.status === "BROUILLON").length;
  const validatedCount = creditNotes.filter((note) => note.status === "VALIDE").length;

  const cards = [
    {
      label: "Nombre total d'avoirs",
      value: creditNotes.length.toLocaleString("fr-FR"),
      icon: Files,
    },
    {
      label: "Montant total des avoirs",
      value: formatCurrency(totalAmount),
      icon: ReceiptText,
    },
    {
      label: "Avoirs en brouillon",
      value: draftCount.toLocaleString("fr-FR"),
      icon: FileClock,
    },
    {
      label: "Avoirs valides",
      value: validatedCount.toLocaleString("fr-FR"),
      icon: FileCheck2,
    },
  ] as const;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card
            key={card.label}
            className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
          >
            <CardContent className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </p>
                <p className="font-heading text-2xl font-semibold text-foreground">
                  {card.value}
                </p>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
