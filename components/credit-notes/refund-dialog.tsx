"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { creditNoteReasonLabels } from "@/lib/credit-note-calculations";
import {
  CREDIT_NOTE_JUSTIFICATION_MIN_LENGTH,
  CREDIT_NOTE_PAYMENT_MODE_LABEL,
  clientReasonOptions,
  supplierReasonOptions,
} from "@/lib/credit-note-pos";
import { formatCurrency } from "@/lib/utils";
import type { CreditNotePartyType, CreditNoteReason } from "@/types/credit-note";
import type { StockLocationDto } from "@/types/operations-dto";

type RefundDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  party: CreditNotePartyType;
  partyName: string;
  totalTTC: number;
  depots: StockLocationDto[];
  depotId: string;
  onDepotChange: (depotId: string) => void;
  reason: CreditNoteReason;
  onReasonChange: (reason: CreditNoteReason) => void;
  comment: string;
  onCommentChange: (comment: string) => void;
  busy: boolean;
  /** Why « Encaisser » cannot be confirmed yet (null = it can). */
  blockingReason: string | null;
  onConfirm: () => void;
};

/**
 * The « Encaisser » step of an avoir: the payment mode is fixed to « Rembourser » (money goes BACK to the
 * customer - it is never a collection), the amount is the cart total, and the operator only confirms the
 * reason, the justification and the depot the goods go back to. One click = one request: the button is
 * disabled while it runs, and the screen reuses the same idempotency key until the avoir is saved.
 */
export function RefundDialog(props: RefundDialogProps) {
  const { open, onOpenChange, party, partyName, busy } = props;
  const isClient = party === "client";
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isClient ? "Avoir client" : "Avoir fournisseur"}</DialogTitle>
          <DialogDescription>
            {partyName} &middot; {isClient ? "Remboursement du client" : "Retour au fournisseur"}
          </DialogDescription>
        </DialogHeader>
        <RefundForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** The body and the buttons of the dialog (no dialog context needed: testable on its own). */
export function RefundForm({
  onOpenChange,
  party,
  totalTTC,
  depots,
  depotId,
  onDepotChange,
  reason,
  onReasonChange,
  comment,
  onCommentChange,
  busy,
  blockingReason,
  onConfirm,
}: RefundDialogProps) {
  const isClient = party === "client";
  const reasons = isClient ? clientReasonOptions : supplierReasonOptions;

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Mode de règlement</span>
            <span className="font-semibold text-emerald-700" data-testid="refund-payment-mode">
              {CREDIT_NOTE_PAYMENT_MODE_LABEL}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-base font-semibold text-foreground">Montant à rembourser</span>
            <span className="text-2xl font-bold text-emerald-700 tabular-nums">
              {formatCurrency(totalTTC)}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {isClient
              ? "Sortie d'espèces de la caisse : le montant est remboursé au client, il n'est pas encaissé."
              : "Avoir fournisseur : aucun mouvement de caisse, l'avoir vient en déduction du compte du fournisseur."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{isClient ? "Dépôt de réintégration" : "Dépôt source"}</Label>
            <Select value={depotId} onValueChange={(value) => value && onDepotChange(value)}>
              <SelectTrigger className="h-10 w-full" disabled={busy}>
                <SelectValue placeholder="Sélectionner un dépôt">
                  {(value: string | null) =>
                    depots.find((depot) => depot.id === value)?.name ?? "Sélectionner un dépôt"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {depots.map((depot) => (
                  <SelectItem key={depot.id} value={depot.id}>
                    {depot.name} - {depot.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Motif</Label>
            <Select
              value={reason}
              onValueChange={(value) => value && onReasonChange(value as CreditNoteReason)}
            >
              <SelectTrigger className="h-10 w-full" disabled={busy}>
                <SelectValue placeholder="Sélectionner un motif">
                  {(value: CreditNoteReason | null) =>
                    value ? creditNoteReasonLabels[value] : "Sélectionner un motif"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {reasons.map((option) => (
                  <SelectItem key={option} value={option}>
                    {creditNoteReasonLabels[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="refund-justification">
            {isClient
              ? `Justification (obligatoire, ${CREDIT_NOTE_JUSTIFICATION_MIN_LENGTH} caractères minimum)`
              : "Justification"}
          </Label>
          <Textarea
            id="refund-justification"
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder="Motif détaillé du retour..."
            disabled={busy}
          />
        </div>

        {blockingReason ? <p className="text-sm text-muted-foreground">{blockingReason}</p> : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
          Retour
        </Button>
        <Button type="button" disabled={busy || blockingReason !== null} onClick={onConfirm}>
          {busy ? (
            <>
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Enregistrement…
            </>
          ) : (
            `Rembourser ${formatCurrency(totalTTC)}`
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
