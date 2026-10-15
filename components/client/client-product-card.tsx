"use client";

import { Plus } from "lucide-react";

import { ClientQuantityStepper } from "@/components/client/client-quantity-stepper";
import { ProductMedia } from "@/components/products/product-media";
import { cn } from "@/lib/utils";
import type { ClientCatalogProductDto } from "@/types/client-portal";

type ClientProductCardProps = {
  product: ClientCatalogProductDto;
  /** Units of this product already in the cart (0 = not in the cart). */
  quantityInCart: number;
  onAdd: (product: ClientCatalogProductDto) => void;
  /** New quantity for this product; 0 takes it out of the cart. */
  onQuantityChange: (product: ClientCatalogProductDto, quantity: number) => void;
  onOpenDetails: (product: ClientCatalogProductDto) => void;
};

/**
 * A catalogue card of the Espace Client: photo, designation, reference, availability and the cart control.
 * No price, total or discount of any kind - the DTO does not even carry one.
 */
export function ClientProductCard({ product, quantityInCart, onAdd, onQuantityChange, onOpenDetails }: ClientProductCardProps) {
  return (
    <article
      data-testid="client-product-card"
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_6px_18px_rgba(15,23,42,0.05)] transition-colors",
        quantityInCart > 0 ? "border-emerald-300" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDetails(product)}
        className="relative block focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:outline-none"
        aria-label={`Voir la fiche de ${product.name}`}
      >
        <ProductMedia
          imageUrl={product.imageUrl}
          alt={product.name}
          fit="cover"
          sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 48vw"
          className="aspect-square w-full rounded-none bg-slate-50"
        />
        <AvailabilityBadge available={product.available} className="absolute top-2 left-2" />
      </button>

      <div className="flex flex-1 flex-col gap-2 p-2.5 sm:p-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpenDetails(product)}
            className="line-clamp-2 min-h-[2.5em] text-left text-[15px] leading-tight font-semibold text-foreground hover:text-emerald-700"
          >
            {product.name}
          </button>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Réf. {product.reference}</p>
        </div>

        <div className="mt-auto">
          {quantityInCart > 0 ? (
            <ClientQuantityStepper
              value={quantityInCart}
              min={0}
              fullWidth
              label={product.name}
              onChange={(quantity) => onQuantityChange(product, quantity)}
            />
          ) : (
            <button
              type="button"
              onClick={() => onAdd(product)}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 active:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:outline-none"
              aria-label={`Ajouter ${product.name} au panier`}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Ajouter
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** « Disponible » (depot stock) / « Sur commande » (none in the depots - still orderable): a yes/no, never a quantity. */
export function AvailabilityBadge({ available, className }: { available: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm ring-1",
        available ? "bg-white/95 text-emerald-700 ring-emerald-200" : "bg-white/95 text-amber-700 ring-amber-200",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", available ? "bg-emerald-500" : "bg-amber-500")} />
      {available ? "Disponible" : "Sur commande"}
    </span>
  );
}
