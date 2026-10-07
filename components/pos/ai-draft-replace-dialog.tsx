"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const AI_DRAFT_REPLACE_MESSAGE =
  "Ton panier contient déjà des produits. Veux-tu le remplacer par le panier préparé par l'Assistant IA ?";

type AiDraftReplaceDialogProps = {
  open: boolean;
  busy?: boolean;
  onReplace: () => void;
  onCancel: () => void;
};

/**
 * Asked when an AI-prepared cart is opened while the POS cart already holds
 * products: the current cart is never overwritten (nor merged) silently.
 */
export function AiDraftReplaceDialog({ open, busy = false, onReplace, onCancel }: AiDraftReplaceDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Panier préparé par l&apos;Assistant IA</DialogTitle>
          <DialogDescription>{AI_DRAFT_REPLACE_MESSAGE}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Annuler
          </Button>
          <Button type="button" onClick={onReplace} disabled={busy}>
            Remplacer le panier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
