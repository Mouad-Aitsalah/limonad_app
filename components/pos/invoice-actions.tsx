import { Ban, FileText, PauseCircle, Printer, Send, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PosOperationType } from "@/types/pos";

type InvoiceActionsProps = {
  operationType: PosOperationType;
  disabled: boolean;
  loading?: boolean;
  onCheckout: () => void;
  onPrint: () => void;
};

export function InvoiceActions({
  operationType,
  disabled,
  loading = false,
  onCheckout,
  onPrint,
}: InvoiceActionsProps) {
  const isTransfer = operationType === "transfer";
  const Icon = isTransfer ? Send : Wallet;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        disabled={disabled || loading}
        onClick={onCheckout}
        className={
          isTransfer
            ? "h-12 w-full bg-blue-600 text-base text-white hover:bg-blue-700"
            : "h-12 w-full text-base"
        }
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
        {loading ? "Validation..." : isTransfer ? "Transferer le stock" : "Encaisser"}
      </Button>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button type="button" variant="outline" size="sm">
          <PauseCircle aria-hidden="true" className="h-4 w-4" />
          Attente
        </Button>
        <Button type="button" variant="outline" size="sm">
          <FileText aria-hidden="true" className="h-4 w-4" />
          Devis
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onPrint}>
          <Printer aria-hidden="true" className="h-4 w-4" />
          Imprimer
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <Ban aria-hidden="true" className="h-4 w-4" />
          Annuler
        </Button>
      </div>
    </div>
  );
}
