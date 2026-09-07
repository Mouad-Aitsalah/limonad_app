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
      )}
    >
      {tone.alert && (
        <span className="absolute top-1.5 right-1.5 z-10 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-600">
          {product.quantiteStock < 0 ? "Stock négatif" : "Rupture"}
        </span>
      )}

      {/* Image fills the tile edge to edge (object-cover) - the green
          background only shows through on the no-photo placeholder. */}
      <ProductMedia
        imageUrl={product.imageUrl}
        alt={`Photo du produit ${product.designation}`}
        fit="cover"
        className="aspect-[3/2] w-full rounded-xl"
        imageClassName="transition-transform duration-200 group-hover:scale-[1.03]"
      />

      <div className="mt-1.5 flex flex-1 flex-col px-0.5">
        <p className="line-clamp-2 pr-12 text-[12px] font-medium leading-snug text-foreground">
          {product.designation}
        </p>
        {product.reference ? (
          <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
            {product.reference}
          </p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          <div className="min-w-0">
            <span className="text-[12px] font-semibold text-emerald-700">
              {formatCurrency(product.prixVenteTTC)}
            </span>
            <p className={cn("text-[10px] leading-tight", tone.textClassName)}>
              {tone.label(product.quantiteStock)}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-emerald-700">
            Ajouter
          </span>
        </div>
      </div>
    </button>
  );
}
