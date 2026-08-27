import Image from "next/image";
import { CircleCheck, CircleX, Eye, PackageSearch, Pencil, Power } from "lucide-react";

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
import { formatCurrency } from "@/lib/utils";
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
};

export function ProductsTable({
  products,
  onView,
  onEdit,
  onToggleStatus,
}: ProductsTableProps) {
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Photo</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Code-barres</TableHead>
          <TableHead>Designation</TableHead>
          <TableHead>Categorie</TableHead>
          <TableHead>Marque</TableHead>
          <TableHead>Fournisseur</TableHead>
          <TableHead className="text-right">Prix achat TTC</TableHead>
          <TableHead className="text-right">Prix vente TTC</TableHead>
          <TableHead className="text-right">TVA</TableHead>
          <TableHead className="text-right">Stock min.</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => {
          const active = product.status === "ACTIVE";

          return (
            <TableRow key={product.id}>
              <TableCell>
                <ProductThumbnail
                  imageUrl={product.imageUrl}
                  name={product.name}
                />
              </TableCell>
              <TableCell className="font-medium text-foreground">
                {product.reference}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {product.barcode ?? "-"}
              </TableCell>
              <TableCell className="text-foreground">{product.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {product.category.name}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {product.brand?.name ?? "-"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {product.supplier?.name ?? "-"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(computePriceTTC(product.purchasePrice, product.taxRate))}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatCurrency(computePriceTTC(product.salePrice, product.taxRate))}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {product.taxRate.toLocaleString("fr-FR")}%
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {product.minimumStock}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    active
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }
                >
                  <BooleanIndicator
                    value={active}
                    label={active ? "Actif" : "Inactif"}
                  />
                  {active ? "Actif" : "Inactif"}
                </Badge>
              </TableCell>
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
