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
  /** Defaults to the AI-assistant wording; the online-order flow passes its own. */
  title?: string;
  message?: string;
};

/**
 * Asked when a prepared cart (AI assistant, online customer order) is opened
 * while the POS cart already holds products: the current cart is never
 * overwritten (nor merged) silently.
 */
export function AiDraftReplaceDialog({
  open,
  busy = false,
  onReplace,
  onCancel,
  title = "Panier préparé par l'Assistant IA",
  message = AI_DRAFT_REPLACE_MESSAGE,
}: AiDraftReplaceDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
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
