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
        "group relative flex flex-col rounded-2xl border border-border bg-card p-1.5 text-left ring-0 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_16px_30px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/20",
        // Mobile: a small, near-square launcher tile - centred rounded-square
        // icon, 2-line name, one tight price/stock row and a mini add pill.
        // Desktop keeps the wide-photo card above (classes apply at >= lg).
        "max-lg:min-w-0 max-lg:touch-manipulation max-lg:items-center max-lg:gap-0.5 max-lg:p-1.5",
      )}
    >
      {tone.alert && (
        <span className="absolute top-1.5 right-1.5 z-10 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-600 max-lg:top-1 max-lg:right-1 max-lg:px-1 max-lg:text-[8px]">
          {product.quantiteStock < 0 ? (
            <>
              <span className="max-lg:hidden">Stock négatif</span>
              <span className="lg:hidden">Négatif</span>
            </>
          ) : (
            "Rupture"
          )}
        </span>
      )}

      {/* Wide photo on desktop; a small rounded-square icon on mobile
          (placeholder uses the same footprint). */}
      <ProductMedia
        imageUrl={product.imageUrl}
        alt={`Photo du produit ${product.designation}`}
        fit="cover"
        className="aspect-[3/2] w-full rounded-xl max-lg:aspect-square max-lg:w-[68px] max-lg:shrink-0 max-lg:rounded-[18px]"
        imageClassName="transition-transform duration-200 group-hover:scale-[1.03]"
      />

      <div className="mt-1.5 flex flex-1 flex-col px-0.5 max-lg:mt-1 max-lg:w-full max-lg:flex-none max-lg:px-0">
        <p className="line-clamp-2 pr-12 text-[12px] font-medium leading-snug text-foreground max-lg:pr-0 max-lg:text-center max-lg:text-[10px] max-lg:leading-[12px]">
          {product.designation}
        </p>
        {product.reference ? (
          <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground max-lg:hidden">
            {product.reference}
          </p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5 max-lg:mt-1 max-lg:w-full max-lg:items-center max-lg:gap-1 max-lg:pt-0.5">
          <div className="min-w-0 max-lg:text-center">
            <span className="text-[12px] font-semibold text-emerald-700 max-lg:block max-lg:text-[11px] max-lg:leading-none">
              {formatCurrency(product.prixVenteTTC)}
            </span>
            <p
              className={cn(
                "text-[10px] leading-tight max-lg:text-[9px]",
                tone.textClassName,
              )}
            >
              {tone.label(product.quantiteStock)}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-emerald-700 max-lg:px-2 max-lg:py-0.5 max-lg:text-[8px] max-lg:tracking-normal">
            Ajouter
          </span>
        </div>
      </div>
    </button>
  );
}
