"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PurchaseForm } from "@/components/achats/purchase-form";
import type { PurchaseInput } from "@/types/purchase";
import type { ProductDto, ProductOptionDto } from "@/types/product-dto";

type PurchaseDialogProps = {
  onSaved: (purchase: PurchaseInput) => Promise<void>;
  supplierOptions: ProductOptionDto[];
  productOptions: ProductDto[];
};

export function PurchaseDialog({
  onSaved,
  productOptions,
  supplierOptions,
}: PurchaseDialogProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Nouveau Achat
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Nouvel achat</DialogTitle>
          <DialogDescription>
            Enregistrez une facture d&apos;achat fournisseur. Aucune donnée
            n&apos;est persistée au-delà de cette session (simulation).
          </DialogDescription>
        </DialogHeader>

        <PurchaseForm
          key={open ? "open" : "closed"}
          onCancel={() => setOpen(false)}
          productOptions={productOptions}
          supplierOptions={supplierOptions}
          onSaved={async (purchase) => {
            await onSaved(purchase);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
