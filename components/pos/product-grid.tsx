import type * as React from "react";
import { PackageSearch } from "lucide-react";

import { ProductCard } from "@/components/pos/product-card";
import type { PosProduct } from "@/types/pos";

type ProductGridProps = {
  products: PosProduct[];
  onAdd: (productId: string) => boolean | void;
  onAdded?: (product: PosProduct, sourceElement: HTMLElement) => void;
  /**
   * Counter POS "Personnaliser l'affichage": when given, the grid and the cards
   * follow the CSS variables of PosCatalogScroller (card min width, gap, name
   * size, photo height) and the photos can be hidden. Omitted (the driver POS)
   * = the layout below, unchanged.
   */
  display?: { showPhotos: boolean };
};

/** Custom display: as many cards per row as fit the available width (min width variable, never wider than the container). */
const CUSTOM_GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns: "repeat(auto-fill, minmax(min(var(--pos-card-min, 150px), 100%), 1fr))",
  gap: "var(--pos-gap, 8px)",
};

export function ProductGrid({ products, onAdd, onAdded, display }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <PackageSearch
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun produit ne correspond à cette recherche.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        display
          ? "grid min-w-0 items-start lg:items-stretch"
          : "grid grid-cols-3 items-start gap-1.5 lg:grid-cols-2 lg:items-stretch lg:gap-3 xl:grid-cols-3 2xl:grid-cols-4"
      }
      style={display ? CUSTOM_GRID_STYLE : undefined}
    >
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onAdd={onAdd} onAdded={onAdded} display={display} />
      ))}
    </div>
  );
}
