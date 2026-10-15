"use client";

import * as React from "react";
import { ShoppingCart } from "lucide-react";

import { AvailabilityBadge } from "@/components/client/client-product-card";
import { ClientQuantityStepper } from "@/components/client/client-quantity-stepper";
import { ProductMedia } from "@/components/products/product-media";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ClientCatalogProductDto } from "@/types/client-portal";

type ClientProductDialogProps = {
  product: ClientCatalogProductDto | null;
  /** Units already in the cart, shown so the customer knows what is there. */
  quantityInCart: number;
  onClose: () => void;
  onAdd: (product: ClientCatalogProductDto, quantity: number) => void;
};

/** The product sheet: photo, designation, reference, category, description, availability, quantity to add. No price. */
export function ClientProductDialog({ product, quantityInCart, onClose, onAdd }: ClientProductDialogProps) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => (open ? null : onClose())}>
      {product ? (
        <ProductSheet key={product.id} product={product} quantityInCart={quantityInCart} onClose={onClose} onAdd={onAdd} />
      ) : null}
    </Dialog>
  );
}

function ProductSheet({
  product,
  quantityInCart,
  onClose,
  onAdd,
}: {
  product: ClientCatalogProductDto;
  quantityInCart: number;
  onClose: () => void;
  onAdd: (product: ClientCatalogProductDto, quantity: number) => void;
}) {
  const [quantity, setQuantity] = React.useState(1);
  return (
    <DialogContent className="max-h-[90dvh] gap-4 overflow-y-auto sm:max-w-md">
      <DialogHeader className="gap-1 pr-8">
        <DialogTitle className="text-lg leading-snug">{product.name}</DialogTitle>
        <DialogDescription>
          Réf. {product.reference} · {product.categoryName}
        </DialogDescription>
      </DialogHeader>

      <div className="relative">
        <ProductMedia
          imageUrl={product.imageUrl}
          alt={product.name}
          fit="contain"
          sizes="(min-width: 640px) 28rem, 90vw"
          className="aspect-square w-full rounded-2xl bg-slate-50"
        />
        <AvailabilityBadge available={product.available} className="absolute top-3 left-3" />
      </div>

      {product.description ? <p className="text-sm text-muted-foreground">{product.description}</p> : null}
      {quantityInCart > 0 ? (
        <p className="text-sm font-medium text-emerald-700">Déjà {quantityInCart} dans votre panier.</p>
      ) : null}

      <div className="flex items-center gap-2">
        <ClientQuantityStepper value={quantity} onChange={setQuantity} label={product.name} />
        <button
          type="button"
          onClick={() => {
            onAdd(product, quantity);
            onClose();
          }}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 active:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <ShoppingCart aria-hidden="true" className="h-4 w-4" />
          Ajouter au panier
        </button>
      </div>
    </DialogContent>
  );
}
