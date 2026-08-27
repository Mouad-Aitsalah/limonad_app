import { PackageSearch } from "lucide-react";

import { ProductCard } from "@/components/pos/product-card";
import type { PosProduct } from "@/types/pos";

type ProductGridProps = {
  products: PosProduct[];
  onAdd: (productId: string) => void;
};

export function ProductGrid({ products, onAdd }: ProductGridProps) {
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
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onAdd={onAdd} />
      ))}
    </div>
  );
}
