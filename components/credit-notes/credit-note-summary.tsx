import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils";

type CreditNoteSummaryProps = {
  totalHT: number;
  discountAmount: number;
  taxAmount: number;
  totalTTC: number;
  typeLabel?: string;
};

export function CreditNoteSummary({
  totalHT,
  discountAmount,
  taxAmount,
  totalTTC,
  typeLabel = "Avoir",
}: CreditNoteSummaryProps) {
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Type</span>
        <span className="font-medium text-emerald-700">{typeLabel}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Sous-total HT</span>
        <span className="tabular-nums text-foreground">
          {formatCurrency(totalHT)}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Remise</span>
        <span className="tabular-nums text-red-600">
          - {formatCurrency(discountAmount)}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">TVA</span>
        <span className="tabular-nums text-foreground">
          {formatCurrency(taxAmount)}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Total TTC</span>
        <span className="tabular-nums text-foreground">
          {formatCurrency(totalTTC)}
        </span>
      </div>

      <Separator className="my-1" />

      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-foreground">
          Montant de l&apos;avoir
        </span>
        <span className="text-xl font-bold text-emerald-700 tabular-nums">
          {formatCurrency(totalTTC)}
        </span>
      </div>
    </div>
  );
}
