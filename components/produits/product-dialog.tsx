"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProductForm } from "@/components/produits/product-form";
import type {
  ProductDto,
  ProductMutationInput,
  ProductOptionDto,
} from "@/types/product-dto";

type ProductDialogProps = {
  product?: ProductDto | null;
  mode?: "edit" | "view";
  categories: ProductOptionDto[];
  brands: ProductOptionDto[];
  suppliers: ProductOptionDto[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSave: (
    values: ProductMutationInput,
    productId?: string,
  ) => Promise<Record<string, string> | null>;
  onRefresh: () => Promise<void>;
};

export function ProductDialog({
  product = null,
  mode = "edit",
  categories,
  brands,
  suppliers,
  open: controlledOpen,
  onOpenChange,
  onSave,
  onRefresh,
}: ProductDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const isEditing = Boolean(product) && mode === "edit";
  const isViewing = Boolean(product) && mode === "view";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!product && (
        <DialogTrigger
          render={<Button type="button" size="lg" className="w-full sm:w-auto" />}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nouveau produit
        </DialogTrigger>
      )}

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isViewing
              ? "Consultation produit"
              : isEditing
                ? "Modifier le produit"
                : "Nouveau produit"}
          </DialogTitle>
          <DialogDescription>
            {isViewing
              ? "Informations issues de PostgreSQL via Prisma."
              : "Renseignez les informations catalogue. Le stock reste gere dans StockLevel."}
          </DialogDescription>
        </DialogHeader>

        <ProductForm
          product={product}
          readOnly={isViewing}
          categories={categories}
          brands={brands}
          suppliers={suppliers}
          onCancel={() => setOpen(false)}
          onSaved={async (values) => {
            const errors = await onSave(values, product?.id);
            if (!errors) {
              setOpen(false);
              await onRefresh();
            }
            return errors;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
