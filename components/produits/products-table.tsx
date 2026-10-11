import Image from "next/image";
import { CircleCheck, CircleX, Eye, PackageSearch, Pencil, Power } from "lucide-react";

import { ProductsMobileList } from "@/components/produits/products-mobile-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computePriceTTC } from "@/lib/product-pricing";
import {
  DEFAULT_PRODUCT_COLUMN_SETTINGS,
  visibleProductColumns,
  type ProductColumnKey,
  type ProductColumnSettings,
} from "@/lib/product-columns";
import { cn, formatCurrency } from "@/lib/utils";
import type { ProductDto } from "@/types/product-dto";

const passthroughImageLoader = ({ src }: { src: string }) => src;

function BooleanIndicator({
  value,
  label,
}: {
  value: boolean;
  label: string;
}) {
  return value ? (
    <CircleCheck aria-label={label} className="h-4 w-4 text-emerald-600" />
  ) : (
    <CircleX
      aria-label={label}
      className="h-4 w-4 text-muted-foreground/50"
    />
  );
}

type ProductsTableProps = {
  products: ProductDto[];
  onView: (product: ProductDto) => void;
  onEdit: (product: ProductDto) => void;
  onToggleStatus: (product: ProductDto) => void;
  /** The organisation's column choice (lib/product-columns.ts). Absent = the default columns. */
  columnSettings?: ProductColumnSettings;
};

/** A tier price HT shown TTC, or "-" when it is not set. */
function optionalPriceTTC(priceHT: number | null | undefined, taxRate: number) {
  return priceHT == null ? "-" : formatCurrency(computePriceTTC(priceHT, taxRate));
}

/** The content of one cell - one entry per configurable column. */
function renderProductCell(key: ProductColumnKey, product: ProductDto, active: boolean) {
  switch (key) {
    case "photo":
      return <ProductThumbnail imageUrl={product.imageUrl} name={product.name} />;
    case "reference":
      return product.reference;
    case "designation":
      return product.name;
    case "category":
      return product.category.name;
    case "supplier":
      return product.supplier?.name ?? "-";
    case "purchasePriceTTC":
      return formatCurrency(computePriceTTC(product.purchasePrice, product.taxRate));
    case "retailPriceTTC":
      return optionalPriceTTC(product.retailPrice, product.taxRate);
    case "semiWholesalePriceTTC":
      return optionalPriceTTC(product.semiWholesalePrice, product.taxRate);
    case "salePriceTTC":
      return formatCurrency(computePriceTTC(product.salePrice, product.taxRate));
    case "semiWholesaleMinQty":
      return product.semiWholesaleMinQty ?? "-";
    case "wholesaleMinQty":
      return product.wholesaleMinQty ?? "-";
    case "unit":
      return product.unit || "-";
    case "taxRate":
      return `${product.taxRate.toLocaleString("fr-FR")}%`;
    case "stockQuantity":
      return product.stockQuantity == null ? "-" : product.stockQuantity.toLocaleString("fr-FR");
    case "minimumStock":
      return product.minimumStock;
    case "status":
      return (
        <Badge
          variant="outline"
          className={
            active
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
          }
        >
          <BooleanIndicator value={active} label={active ? "Actif" : "Inactif"} />
          {active ? "Actif" : "Inactif"}
        </Badge>
      );
  }
}

/** Cell classes - the existing columns keep exactly their previous look. */
const CELL_CLASS: Partial<Record<ProductColumnKey, string>> = {
  reference: "font-medium text-foreground",
  designation: "text-foreground",
  category: "text-muted-foreground",
  supplier: "text-muted-foreground",
  purchasePriceTTC: "text-right tabular-nums",
  retailPriceTTC: "text-right tabular-nums",
  semiWholesalePriceTTC: "text-right tabular-nums",
  salePriceTTC: "text-right font-medium tabular-nums",
  semiWholesaleMinQty: "text-right tabular-nums",
  wholesaleMinQty: "text-right tabular-nums",
  unit: "text-muted-foreground",
  taxRate: "text-right tabular-nums",
  stockQuantity: "text-right tabular-nums",
  minimumStock: "text-right text-muted-foreground tabular-nums",
};

export function ProductsTable({
  products,
  onView,
  onEdit,
  onToggleStatus,
  columnSettings = DEFAULT_PRODUCT_COLUMN_SETTINGS,
}: ProductsTableProps) {
  const columns = visibleProductColumns(columnSettings);

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <PackageSearch
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun produit ne correspond a ces criteres.
        </p>
      </div>
    );
  }

  return (
    <>
    {/* Phones / tablets: one card per product. From lg the table below is untouched. */}
    <div className="lg:hidden">
      <ProductsMobileList
        products={products}
        onView={onView}
        onEdit={onEdit}
        onToggleStatus={onToggleStatus}
      />
    </div>
    <div className="max-lg:hidden">
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.key}
              data-column={column.key}
              className={column.align === "right" ? "text-right" : undefined}
            >
              {column.header}
            </TableHead>
          ))}
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => {
          const active = product.status === "ACTIVE";

          return (
            <TableRow key={product.id}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    CELL_CLASS[column.key],
                    // a negative stock reads red, like everywhere else
                    column.key === "stockQuantity" && (product.stockQuantity ?? 0) < 0 && "text-red-600",
                  )}
                >
                  {renderProductCell(column.key, product, active)}
                </TableCell>
              ))}
              <TableCell>
                <div className="flex justify-end gap-2">
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
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>
    </>
  );
}

function ProductThumbnail({
  imageUrl,
  name,
}: {
  imageUrl?: string | null;
  name: string;
}) {
  if (imageUrl) {
    return (
      <Image
        loader={passthroughImageLoader}
        unoptimized
        src={imageUrl}
        alt={name}
        width={48}
        height={48}
        className="h-12 w-12 rounded-xl border border-border object-cover"
      />
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-[radial-gradient(circle_at_top,#d1fae5,transparent_58%),linear-gradient(135deg,#ecfdf5_0%,#d1fae5_100%)] text-emerald-700">
      <PackageSearch className="h-5 w-5" />
    </div>
  );
}
