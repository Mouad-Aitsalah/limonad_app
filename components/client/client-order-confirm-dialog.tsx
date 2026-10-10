"use client";

import * as React from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import type { ClientCartLine } from "@/types/client-portal";

type ClientOrderConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: ClientCartLine[];
  total: number;
  customerName: string;
  contactPhone: string | null;
  submitting: boolean;
  onConfirm: (note: string) => void;
};

/** The recap the customer confirms before the order is sent. */
export function ClientOrderConfirmDialog({
  open,
  onOpenChange,
  cart,
  total,
  customerName,
  contactPhone,
  submitting,
  onConfirm,
}: ClientOrderConfirmDialogProps) {
  const [note, setNote] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={(next) => (submitting ? null : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmer la commande</DialogTitle>
          <DialogDescription>
            Commande au nom de {customerName}
            {contactPhone ? ` · contact ${contactPhone}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
          {cart.map((line) => (
            <li key={line.productId} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                {line.productName} <span className="text-muted-foreground">× {line.quantity}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatCurrency(line.priceTTC * line.quantity)}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-border pt-3 font-semibold">
          <span>Total estimé TTC</span>
          <span className="tabular-nums text-emerald-700">{formatCurrency(total)}</span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="client-order-note">
            Note pour le fournisseur <span className="font-normal text-muted-foreground">(facultatif)</span>
          </Label>
          <Textarea
            id="client-order-note"
            maxLength={500}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex. livraison le matin"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Retour
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => onConfirm(note)}
            disabled={submitting || cart.length === 0}
          >
            {submitting ? "Envoi..." : "Confirmer et envoyer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
