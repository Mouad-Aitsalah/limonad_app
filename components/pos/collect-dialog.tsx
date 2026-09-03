"use client";

import * as React from "react";
import { Printer } from "lucide-react";

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
import { formatCustomerCode } from "@/lib/customer-code";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";
import { defaultPaymentMethod, posPaymentMethods, type PosPaymentMethodValue } from "@/types/pos";

type CollectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: SaleDto | null;
  submitting?: boolean;
  onCollect: (method: PosPaymentMethodValue, paidAmount?: number) => Promise<void> | void;
  onPrint: () => void;
};

function CollectForm({
  sale,
  submitting,
  onCollect,
  onPrint,
}: {
  sale: SaleDto;
  submitting: boolean;
  onCollect: (method: PosPaymentMethodValue, paidAmount?: number) => Promise<void> | void;
  onPrint: () => void;
}) {
  const total = sale.totalTTC;
  const [method, setMethod] = React.useState<PosPaymentMethodValue>(defaultPaymentMethod);
  const [received, setReceived] = React.useState(total);
  const changeDue = Math.max(0, received - total);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onCollect(method, method === "MIXED" ? received : undefined);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="collect-method">Mode de règlement</Label>
        <select
          id="collect-method"
          value={method}
          onChange={(event) => setMethod(event.target.value as PosPaymentMethodValue)}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-emerald-500 focus:ring-3 focus:ring-emerald-500/15"
        >
          {posPaymentMethods.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {method === "MIXED" ? (
        <div className="space-y-2">
          <Label htmlFor="collect-received">Montant reçu (espèces)</Label>
          <Input
            id="collect-received"
            type="number"
            min={0}
            step="0.01"
            value={received}
            onChange={(event) => setReceived(Number(event.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Monnaie à rendre : {formatCurrency(changeDue)}
          </p>
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onPrint}>
          <Printer aria-hidden="true" className="h-4 w-4" />
          Imprimer
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Encaissement..." : "Encaisser"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Encaissement d'une facture du jour: on choisit le mode de règlement ici
 * (la facture préparée n'en avait pas), on peut imprimer avant d'encaisser,
 * puis "Encaisser". Le serveur est idempotent - un double clic n'encaisse
 * qu'une fois.
 */
export function CollectDialog({
  open,
  onOpenChange,
  sale,
  submitting = false,
  onCollect,
  onPrint,
}: CollectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl">Encaisser la facture</DialogTitle>
          <DialogDescription>
            {sale?.customer
              ? `${formatCustomerCode(sale.customer.code)} · ${sale.customer.name}`
              : "Client comptoir"}
            {sale ? ` — ${formatCurrency(sale.totalTTC)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {sale ? (
          <CollectForm
            key={`${sale.id}:${open ? "open" : "closed"}`}
            sale={sale}
            submitting={submitting}
            onCollect={onCollect}
            onPrint={onPrint}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
