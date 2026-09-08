import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils";
import type { CartTotals } from "@/components/pos/pos-layout";
import type { PosOperationType } from "@/types/pos";

type CartSummaryProps = {
  totals: CartTotals;
  operationType: PosOperationType;
};

export function CartSummary({ totals, operationType }: CartSummaryProps) {
  if (operationType === "transfer") {
    return (
      <div className="space-y-2 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Type</span>
          <span className="font-medium text-blue-700">Transfert de stock</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">TVA</span>
          <span className="tabular-nums text-muted-foreground">
            Non applicable
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Chiffre d&apos;affaires</span>
          <span className="tabular-nums text-muted-foreground">
            {formatCurrency(0)}
          </span>
        </div>

        <Separator className="my-1" />

        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-foreground">
            Valeur transferee
          </span>
          <span className="text-xl font-bold text-blue-700 tabular-nums">
            {formatCurrency(totals.transferValue)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-foreground">Total à payer</span>
        <span className="text-2xl font-bold text-emerald-700 tabular-nums">
          {formatCurrency(totals.netAPayer)}
        </span>
      </div>
    </div>
  );
}
