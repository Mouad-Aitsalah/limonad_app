import { ProductMedia } from "@/components/products/product-media";
import type { ProductDto } from "@/types/product-dto";
import { computePriceTTC } from "@/lib/product-pricing";
import { cn, formatCurrency } from "@/lib/utils";

type CommerceProductCardProps = {
  product: ProductDto;
  onSelect: (product: ProductDto) => void;
  disabled?: boolean;
};

export function CommerceProductCard({
  product,
  onSelect,
  disabled = false,
}: CommerceProductCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(product)}
      className={cn(
        "group relative flex min-h-[250px] flex-col rounded-[24px] border border-border bg-card p-3 text-left ring-0 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_16px_30px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/20 disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <ProductMedia
        imageUrl={product.imageUrl}
        alt={`Photo du produit ${product.name}`}
        fit="contain"
        className="h-36 rounded-[18px]"
        imageClassName="p-4 transition-transform duration-200 group-hover:scale-[1.03]"
      />

      <div className="mt-3 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <p className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</p>
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {product.category.name}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{product.reference}</p>
        {product.barcode ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{product.barcode}</p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">
              {formatCurrency(computePriceTTC(product.salePrice, product.taxRate))}
            </p>
            <p className="text-xs text-muted-foreground">Unite {product.unit}</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-700">
            Selectionner
          </span>
        </div>
      </div>
    </button>
  );
}
