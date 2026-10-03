import { Eye, Pencil, Power } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { computePriceTTC } from "@/lib/product-pricing";
import { formatCurrency } from "@/lib/utils";
import type { ProductDto } from "@/types/product-dto";

type ProductsMobileListProps = {
  products: ProductDto[];
  onView: (product: ProductDto) => void;
  onEdit: (product: ProductDto) => void;
  onToggleStatus: (product: ProductDto) => void;
};

/**
 * Phone / tablet (< lg) presentation of the products table: one compact card
 * per product - reference (bold, the main identifier), designation (wraps, may
 * be Arabic), then purchase and sale price side by side. The prices are the
 * very figures the desktop table shows (computePriceTTC on the product's own
 * purchasePrice / salePrice / taxRate): nothing is recalculated differently.
 * The same three row actions (consulter, modifier, activer/désactiver) stay
 * available. Callers render this under `lg:hidden`; the table is untouched.
 */
export function ProductsMobileList({ products, onView, onEdit, onToggleStatus }: ProductsMobileListProps) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2" data-testid="products-mobile-list">
      {products.map((product) => {
        const active = product.status === "ACTIVE";

        return (
          <li
            key={product.id}
            className="min-w-0 rounded-2xl border border-border/70 bg-white p-3 shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-base leading-tight font-bold text-foreground [overflow-wrap:anywhere]">
                  {product.reference}
                </p>
                {!active ? (
                  <Badge variant="outline" className="mt-1 border-slate-200 bg-slate-50 text-slate-600">
                    Inactif
                  </Badge>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Consulter le produit"
                  onClick={() => onView(product)}
                >
                  <Eye aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Modifier le produit"
                  onClick={() => onEdit(product)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant={active ? "destructive" : "outline"}
                  size="icon-sm"
                  aria-label={active ? "Desactiver le produit" : "Activer le produit"}
                  onClick={() => onToggleStatus(product)}
                >
                  <Power aria-hidden="true" />
                </Button>
              </div>
            </div>

            {/* Long and Arabic designations wrap; plaintext lets Arabic start on its own side. */}
            <p className="mt-1 text-sm leading-snug text-foreground [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
              {product.name}
            </p>

            <dl className="mt-2.5 grid grid-cols-2 gap-2">
              <div className="min-w-0 rounded-xl bg-slate-50 px-2.5 py-1.5">
                <dt className="text-[11px] font-medium text-muted-foreground">Prix d&apos;achat</dt>
                <dd className="text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">
                  {formatCurrency(computePriceTTC(product.purchasePrice, product.taxRate))}
                </dd>
              </div>
              <div className="min-w-0 rounded-xl bg-emerald-50 px-2.5 py-1.5">
                <dt className="text-[11px] font-medium text-emerald-800/80">Prix de vente</dt>
                <dd className="text-sm font-bold text-emerald-800 tabular-nums [overflow-wrap:anywhere]">
                  {formatCurrency(computePriceTTC(product.salePrice, product.taxRate))}
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
