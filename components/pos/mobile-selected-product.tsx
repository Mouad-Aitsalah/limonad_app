import { ProductMedia } from "@/components/products/product-media";
import { cn, formatCurrency } from "@/lib/utils";

type MobileSelectedProductProps = {
  className?: string;
  /**
   * "overlay" (default, unchanged): the original `fixed` toast near the
   * bottom of the screen - every existing call site (the counter POS's own
   * pos-layout.tsx) keeps getting exactly this.
   * "inline": a compact, non-fixed row-item sized to sit next to
   * MobileSupplierPicker's trigger (same height) instead of floating over
   * the product grid - see driver-pos-view.tsx's own call site for why.
   */
  variant?: "overlay" | "inline";
  product:
    | {
        designation: string;
        quantity: number;
        priceTTC: number;
        imageUrl?: string | null;
      }
    | null;
};

/** Non-interactive mobile notification, always derived from the real cart. */
export function MobileSelectedProduct({ product, className, variant = "overlay" }: MobileSelectedProductProps) {
  if (!product) return null;

  if (variant === "inline") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          "flex h-9 min-w-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-card/95 px-2 shadow-sm",
          className,
        )}
      >
        <ProductMedia
          imageUrl={product.imageUrl}
          alt={`Photo du produit ${product.designation}`}
          fit="cover"
          className="h-6 w-6 shrink-0 rounded-md"
          sizes="24px"
        />
        <span className="min-w-0 flex-1 truncate text-[11px] leading-none text-foreground">
          <span className="font-semibold">{product.designation}</span>{" "}
          <span className="font-medium text-emerald-700">{formatCurrency(product.priceTTC)}</span>
        </span>
        <span
          className="shrink-0 text-xs font-bold tabular-nums text-emerald-700"
          aria-label={`Quantité : ${product.quantity}`}
        >
          ×{product.quantity}
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "pointer-events-none fixed z-40 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-card/95 p-2.5 shadow-lg backdrop-blur-sm print:hidden",
        className,
      )}
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 5rem)",
        left: "max(0.75rem, env(safe-area-inset-left))",
        right: "max(0.75rem, env(safe-area-inset-right))",
        maxWidth: "26rem",
        marginInline: "auto",
      }}
    >
      <ProductMedia
        imageUrl={product.imageUrl}
        alt={`Photo du produit ${product.designation}`}
        fit="cover"
        className="h-14 w-14 shrink-0 rounded-xl"
        sizes="56px"
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{product.designation}</p>
        <p className="mt-0.5 text-xs font-medium text-emerald-700">{formatCurrency(product.priceTTC)}</p>
      </div>
      <span className="shrink-0 text-right text-xl font-bold tabular-nums text-emerald-700" aria-label={`Quantité : ${product.quantity}`}>
        ×{product.quantity}
      </span>
    </div>
  );
}
