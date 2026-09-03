import { ProductMedia } from "@/components/products/product-media";
import { posStockTone } from "@/lib/pos-stock-display";
import { cn, formatCurrency } from "@/lib/utils";
import type { PosProduct } from "@/types/pos";

type ProductCardProps = {
  product: PosProduct;
  onAdd: (productId: string) => void;
};

export function ProductCard({ product, onAdd }: ProductCardProps) {
  // Negative sales are allowed: stock <= 0 never disables "Ajouter", it is
  // only ever shown in red (see posStockTone).
  const tone = posStockTone(product.quantiteStock);

  return (
    <button
      type="button"
      onClick={() => onAdd(product.id)}
      className={cn(
        "group relative flex min-h-[250px] flex-col rounded-[24px] border border-border bg-card p-3 text-left ring-0 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_16px_30px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/20",
      )}
    >
      {tone.alert && (
        <span className="absolute top-2 right-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
          {product.quantiteStock < 0 ? "Stock négatif" : "Rupture"}
        </span>
      )}

      <ProductMedia
        imageUrl={product.imageUrl}
        alt={`Photo du produit ${product.designation}`}
        fit="contain"
        className="h-36 rounded-[18px]"
        imageClassName="p-4 transition-transform duration-200 group-hover:scale-[1.03]"
      />

      <div className="mt-3 flex flex-1 flex-col">
        <p className="line-clamp-2 pr-16 text-sm font-medium text-foreground">
          {product.designation}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{product.reference}</p>
        {product.barcode ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{product.barcode}</p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <span className="text-sm font-semibold text-emerald-700">
              {formatCurrency(product.prixVenteTTC)}
            </span>
            <p className={cn("mt-1 text-xs", tone.textClassName)}>
              {tone.label(product.quantiteStock)}
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-700">
            Ajouter
          </span>
        </div>
      </div>
    </button>
  );
}
