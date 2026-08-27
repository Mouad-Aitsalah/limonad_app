import { PackageSearch } from "lucide-react";

import { CommerceProductCard } from "@/components/commerce/product-card";
import type { ProductDto } from "@/types/product-dto";

type CommerceProductGridProps = {
  products: ProductDto[];
  onSelect: (product: ProductDto) => void;
  disabled?: boolean;
};

export function CommerceProductGrid({
  products,
  onSelect,
  disabled = false,
}: CommerceProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <PackageSearch
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun produit ne correspond a cette recherche.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4">
      {products.map((product) => (
        <CommerceProductCard
          key={product.id}
          product={product}
          onSelect={onSelect}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
