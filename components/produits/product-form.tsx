"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ProductFormGeneral } from "@/components/produits/product-form-general";
import { ProductFormPricing } from "@/components/produits/product-form-pricing";
import { ProductFormStock } from "@/components/produits/product-form-stock";
import {
  computePriceHTFromTTC,
  computePriceTTC,
} from "@/lib/product-pricing";
import type {
  ProductDto,
  ProductMutationInput,
  ProductOptionDto,
} from "@/types/product-dto";

export type ProductFormValues = Omit<
  ProductMutationInput,
  "purchasePrice" | "salePrice"
> & {
  purchasePriceTTC: number;
  salePriceTTC: number;
};

const defaultValues: ProductFormValues = {
  reference: "",
  barcode: "",
  name: "",
  description: "",
  categoryId: "",
  defaultSupplierId: "",
  brandId: "",
  purchasePriceTTC: 0,
  taxRate: 20,
  salePriceTTC: 0,
  minimumStock: 0,
  unit: "",
  imageUrl: "",
};

type ProductFormProps = {
  product?: ProductDto | null;
  readOnly?: boolean;
  categories: ProductOptionDto[];
  brands: ProductOptionDto[];
  suppliers: ProductOptionDto[];
  onCancel: () => void;
  onSaved: (values: ProductMutationInput) => Promise<Record<string, string> | null>;
};

export function ProductForm({
  product,
  readOnly = false,
  categories,
  brands,
  suppliers,
  onCancel,
  onSaved,
}: ProductFormProps) {
  const [values, setValues] = React.useState<ProductFormValues>(() =>
    productToValues(product),
  );
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = React.useState(false);

  function handleChange<K extends keyof ProductFormValues>(
    field: K,
    value: ProductFormValues[K],
  ) {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;

    // Instant feedback only - the server enforces this too (and also checks
    // the supplier belongs to the org and is active).
    if (!values.defaultSupplierId) {
      setFieldErrors((current) => ({
        ...current,
        defaultSupplierId: "Le fournisseur est obligatoire.",
      }));
      return;
    }

    setIsSaving(true);
    const errors = await onSaved(valuesToMutationInput(values));
    setFieldErrors(errors ?? {});
    setIsSaving(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex-1 space-y-6 overflow-y-auto px-1 py-1">
        <ProductFormGeneral
          values={values}
          onChange={handleChange}
          categories={categories.map(toOption)}
          suppliers={suppliers.map(toOption)}
          brands={brands.map(toOption)}
          fieldErrors={fieldErrors}
          readOnly={readOnly}
        />
        <Separator />
        <ProductFormPricing
          values={values}
          onChange={handleChange}
          fieldErrors={fieldErrors}
          readOnly={readOnly}
        />
        <Separator />
        <ProductFormStock
          values={values}
          onChange={handleChange}
          fieldErrors={fieldErrors}
          readOnly={readOnly}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {readOnly ? "Fermer" : "Annuler"}
        </Button>
        {!readOnly && (
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Enregistrement..." : "Enregistrer"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

function productToValues(product?: ProductDto | null): ProductFormValues {
  if (!product) return defaultValues;

  return {
    reference: product.reference,
    barcode: product.barcode ?? "",
    name: product.name,
    description: product.description ?? "",
    categoryId: product.category.id,
    defaultSupplierId: product.supplier?.id ?? "",
    brandId: product.brand?.id ?? "",
    purchasePriceTTC: computePriceTTC(product.purchasePrice, product.taxRate),
    salePriceTTC: computePriceTTC(product.salePrice, product.taxRate),
    taxRate: product.taxRate,
    minimumStock: product.minimumStock,
    unit: product.unit,
    imageUrl: product.imageUrl ?? "",
  };
}

function valuesToMutationInput(values: ProductFormValues): ProductMutationInput {
  const { purchasePriceTTC, salePriceTTC, ...rest } = values;

  return {
    ...rest,
    purchasePrice: computePriceHTFromTTC(purchasePriceTTC, values.taxRate),
    salePrice: computePriceHTFromTTC(salePriceTTC, values.taxRate),
  };
}

function toOption(option: ProductOptionDto) {
  return { value: option.id, label: option.name };
}
