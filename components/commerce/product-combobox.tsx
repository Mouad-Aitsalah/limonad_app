"use client";

import * as React from "react";
import { Package } from "lucide-react";

import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
} from "@/components/ui/combobox";
import { useProductPickerSearch } from "@/components/commerce/use-product-picker-search";
import { Label } from "@/components/ui/label";
import type { ProductDto } from "@/types/product-dto";

type ProductComboboxProps = {
  value: ProductDto | null;
  onChange: (product: ProductDto | null) => void;
  /** Small, bounded starting set (see getProductPickerPreload) - shown
   * before the user types anything, so the combobox is never empty on
   * open. */
  preload: ProductDto[];
  placeholder?: string;
  label?: string | null;
  disabled?: boolean;
};

/**
 * Phase 3 adversarial audit, CRITICAL #1 fix: replaces the plain <Select>
 * that used to receive every organization product as options
 * (stock-adjustment-dialog.tsx, truck-stock-panel.tsx, purchase-form.tsx -
 * see getProducts()'s doc comment in lib/server/products.ts for the
 * measured 12.5s/56MB finding). Modeled directly on CustomerCombobox: a
 * small preloaded list plus GET /api/products/search (debounced) once the
 * user types - never more than a handful of products in the browser at
 * once, regardless of catalog size.
 */
export function ProductCombobox({
  value,
  onChange,
  preload,
  placeholder = "Selectionner un produit",
  label = "Produit",
  disabled = false,
}: ProductComboboxProps) {
  const [query, setQuery] = React.useState("");
  const { results } = useProductPickerSearch(preload, query);

  return (
    <div className="space-y-2">
      {label ? (
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Package aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </Label>
      ) : null}
      <Combobox
        items={results}
        filter={null}
        value={value}
        onValueChange={(product) => onChange(product)}
        inputValue={query}
        onInputValueChange={setQuery}
        itemToStringLabel={(product: ProductDto | null) => product?.name ?? ""}
        isItemEqualToValue={(a: ProductDto, b: ProductDto) => a.id === b.id}
        disabled={disabled}
      >
        <ComboboxInputGroup>
          <ComboboxInput placeholder={value?.name ?? placeholder} />
          <ComboboxClear />
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxEmpty>Aucun produit trouve.</ComboboxEmpty>
          {results.map((product, index) => (
            <ComboboxItem key={product.id} value={product} index={index}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{product.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {product.reference}
                  {product.barcode ? ` - ${product.barcode}` : ""}
                </span>
              </div>
            </ComboboxItem>
          ))}
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
