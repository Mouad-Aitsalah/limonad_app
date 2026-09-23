import * as React from "react";
import { Check, PackageSearch, Plus } from "lucide-react";

import { ProductMedia } from "@/components/products/product-media";
import { posStockTone } from "@/lib/pos-stock-display";
import { cn, formatCurrency } from "@/lib/utils";
import type { PosProduct } from "@/types/pos";

/**
 * BUG-04 "AMÉLIORER L'INTERFACE DU POS MOBILE" - "1./3./4. AUDIT VISUEL /
 * CARTES PRODUITS / GRILLE".
 *
 * `components/pos/product-grid.tsx` + `product-card.tsx` are reused
 * UNCHANGED everywhere else in the shell - but that pair is ALSO the live
 * design for the web app's own mobile driver POS (components/driver-pos/
 * driver-pos-view.tsx), tuned for a dense 3-per-row tile (11px name, 11px
 * price, 68px icon). Editing it in place would change that already-shipped,
 * already-validated web experience too - out of scope here ("ne pas casser
 * une fonctionnalité existante"). This is a SHELL-ONLY sibling, not a fork
 * of that file's code: same `PosProduct` data, same `onAdd`/`onAdded`
 * contract (so PosScreen's existing addProductById/handleMobileProductAdded
 * wiring - and useFlyToCart, which only ever needs the clicked button
 * element - are reused completely unchanged), same `ProductMedia`/
 * `posStockTone`/`formatCurrency` helpers - only the tile's own markup/
 * sizing differs, tuned for this shell's actual runtime width (~360-412px,
 * phone-only, never resized): 2 columns, larger touch targets, readable
 * text - see this phase's own visual audit report.
 */

type ShellProductGridProps = {
  products: PosProduct[];
  onAdd: (productId: string) => boolean | void;
  onAdded?: (product: PosProduct, sourceElement: HTMLElement) => void;
};

type ShellProductCardProps = {
  product: PosProduct;
  onAdd: ShellProductGridProps["onAdd"];
  onAdded: ShellProductGridProps["onAdded"];
};

export function ShellProductGrid({ products, onAdd, onAdded }: ShellProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <PackageSearch aria-hidden="true" className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Aucun produit ne correspond à cette recherche.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {products.map((product) => (
        <ShellProductCard key={product.id} product={product} onAdd={onAdd} onAdded={onAdded} />
      ))}
    </div>
  );
}

function ShellProductCard({ product, onAdd, onAdded }: ShellProductCardProps) {
  const tone = posStockTone(product.quantiteStock);
  const [justAdded, setJustAdded] = React.useState(false);
  const resetAddedRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (resetAddedRef.current) clearTimeout(resetAddedRef.current);
    };
  }, []);

  function handleAdd(event: React.MouseEvent<HTMLButtonElement>) {
    const added = onAdd(product.id);
    if (added === false || !onAdded) return;

    setJustAdded(true);
    onAdded(product, event.currentTarget);
    if (resetAddedRef.current) clearTimeout(resetAddedRef.current);
    resetAddedRef.current = setTimeout(() => setJustAdded(false), 900);
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      className="group relative flex flex-col gap-2 rounded-2xl border border-border bg-card p-2.5 text-left touch-manipulation transition-transform duration-150 motion-safe:active:scale-[0.97] motion-reduce:transition-none"
    >
      {tone.alert ? (
        <span className="absolute top-2 right-2 z-10 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
          {product.quantiteStock < 0 ? "Négatif" : "Rupture"}
        </span>
      ) : null}

      <ProductMedia
        imageUrl={product.imageUrl}
        alt={`Photo du produit ${product.designation}`}
        fit="cover"
        className="aspect-square w-full rounded-xl"
        iconClassName="h-9 w-9"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground">{product.designation}</p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="text-base leading-none font-bold text-emerald-700">{formatCurrency(product.prixVenteTTC)}</p>
            <p className={cn("mt-1 text-xs leading-none", tone.textClassName)}>{tone.label(product.quantiteStock)}</p>
          </div>
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
              justAdded ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 group-active:bg-emerald-100",
            )}
            aria-hidden="true"
          >
            {justAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </span>
        </div>
      </div>
    </button>
  );
}
