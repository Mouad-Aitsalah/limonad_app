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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCurrency } from "@/lib/utils";
import type { PosOperationType } from "@/types/pos";

type CheckoutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  netAPayer: number;
  transferValue: number;
  paymentMethodLabel: string;
  paymentMethod: string;
  operationType: PosOperationType;
  destinationLabel: string;
  submitting?: boolean;
  onConfirm: (paidAmount?: number) => Promise<void> | void;
};

type CheckoutFormProps = {
  netAPayer: number;
  transferValue: number;
  paymentMethodLabel: string;
  paymentMethod: string;
  operationType: PosOperationType;
  destinationLabel: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (paidAmount?: number) => Promise<void> | void;
};

function CheckoutForm({
  netAPayer,
  transferValue,
  paymentMethodLabel,
  paymentMethod,
  operationType,
  destinationLabel,
  submitting = false,
  onCancel,
  onConfirm,
}: CheckoutFormProps) {
  const [montantRecu, setMontantRecu] = React.useState(netAPayer);
  const monnaieARendre = Math.max(0, montantRecu - netAPayer);
  const isTransfer = operationType === "transfer";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onConfirm(paymentMethod === "MIXED" ? montantRecu : undefined);
  }

  if (isTransfer) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm">
          <p className="text-muted-foreground">Destination</p>
          <p className="font-medium text-blue-800">{destinationLabel}</p>
        </div>

        <div className="space-y-2">
          <Label>Valeur transférée</Label>
          <div className="flex h-9 items-center rounded-lg border border-input bg-muted px-3 text-sm font-medium text-blue-700 tabular-nums">
            {formatCurrency(transferValue)}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Règlement</Label>
          <div className="flex h-9 items-center rounded-lg border border-input bg-muted px-3 text-sm text-muted-foreground">
            Non applicable
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {submitting ? "Validation..." : "Valider le transfert"}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="montantRecu">Montant reçu</Label>
        <Input
          id="montantRecu"
          type="number"
          min={0}
          step="0.01"
          autoFocus
          value={montantRecu}
          onChange={(event) => setMontantRecu(Number(event.target.value))}
        />
      </div>

      <div className="space-y-2">
        <Label>Monnaie à rendre</Label>
        <div
          className={cn(
            "flex h-9 items-center rounded-lg border border-input bg-muted px-3 text-sm font-medium tabular-nums",
            monnaieARendre > 0 ? "text-emerald-700" : "text-muted-foreground",
          )}
        >
          {formatCurrency(monnaieARendre)}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Mode de règlement</Label>
        <div className="flex h-9 items-center rounded-lg border border-input bg-muted px-3 text-sm text-muted-foreground">
          {paymentMethodLabel}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Validation..." : "Valider"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CheckoutDialog({
  open,
  onOpenChange,
  netAPayer,
  transferValue,
  paymentMethodLabel,
  paymentMethod,
  operationType,
  destinationLabel,
  submitting = false,
  onConfirm,
}: CheckoutDialogProps) {
  const isTransfer = operationType === "transfer";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isTransfer ? "Transferer le stock" : "Encaisser"}
          </DialogTitle>
          <DialogDescription>
            {isTransfer
              ? `Transfert vers ${destinationLabel}`
              : `Net a payer : ${formatCurrency(netAPayer)}`}
          </DialogDescription>
        </DialogHeader>

        <CheckoutForm
          key={open ? "open" : "closed"}
          netAPayer={netAPayer}
          transferValue={transferValue}
          paymentMethodLabel={paymentMethodLabel}
          paymentMethod={paymentMethod}
          operationType={operationType}
          destinationLabel={destinationLabel}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}
