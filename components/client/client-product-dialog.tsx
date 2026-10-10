"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientQuantityStepper } from "@/components/client/client-quantity-stepper";
import { ProductMedia } from "@/components/products/product-media";
import { formatCurrency } from "@/lib/utils";
import type { ClientCatalogProductDto } from "@/types/client-portal";

type ClientProductDialogProps = {
  product: ClientCatalogProductDto | null;
  onClose: () => void;
  onAdd: (product: ClientCatalogProductDto, quantity: number) => void;
};

/** The product sheet: photo, designation, reference, price, availability, quantity to add. */
export function ClientProductDialog({ product, onClose, onAdd }: ClientProductDialogProps) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => (open ? null : onClose())}>
      {product ? <ProductSheet key={product.id} product={product} onClose={onClose} onAdd={onAdd} /> : null}
    </Dialog>
  );
}

function ProductSheet({
  product,
  onClose,
  onAdd,
}: {
  product: ClientCatalogProductDto;
  onClose: () => void;
  onAdd: (product: ClientCatalogProductDto, quantity: number) => void;
}) {
  const [quantity, setQuantity] = React.useState(1);
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="pr-6">{product.name}</DialogTitle>
        <DialogDescription>
          Réf. {product.reference} · {product.categoryName}
        </DialogDescription>
      </DialogHeader>

      <ProductMedia imageUrl={product.imageUrl} alt={product.name} fit="contain" className="aspect-square w-full rounded-xl bg-white" />

      {product.description ? <p className="text-sm text-muted-foreground">{product.description}</p> : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xl font-semibold text-emerald-700 tabular-nums">{formatCurrency(product.priceTTC)}</p>
          <p className="text-xs text-muted-foreground">Prix TTC unitaire</p>
        </div>
        {product.available ? (
          <Badge variant="secondary">Disponible</Badge>
        ) : (
          <Badge variant="outline">Sur commande</Badge>
        )}
      </div>

      <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between">
        <ClientQuantityStepper value={quantity} onChange={setQuantity} label={product.name} />
        <Button
          type="button"
          className="bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => {
            onAdd(product, quantity);
            onClose();
          }}
        >
          Ajouter · {formatCurrency(product.priceTTC * quantity)}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
