import { ProductMedia } from "@/components/products/product-media";
import { formatCurrency } from "@/lib/utils";

type MobileSelectedProductProps = {
  product:
    | {
        designation: string;
        quantity: number;
        priceTTC: number;
        imageUrl?: string | null;
      }
    | null;
};

/** A compact, visual summary displayed above the mobile product grid. */
export function MobileSelectedProduct({ product }: MobileSelectedProductProps) {
  if (!product) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Aucun produit sélectionné
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-2.5">
      <ProductMedia
        imageUrl={product.imageUrl}
        alt={`Photo du produit ${product.designation}`}
        fit="cover"
        className="h-12 w-12 shrink-0 rounded-xl"
      />
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-emerald-700">Produit sélectionné</p>
        <p className="truncate text-sm font-semibold text-foreground">{product.designation}</p>
        <p className="text-xs text-muted-foreground">
          Quantité : {product.quantity} · {formatCurrency(product.priceTTC)}
        </p>
      </div>
    </div>
  );
}
