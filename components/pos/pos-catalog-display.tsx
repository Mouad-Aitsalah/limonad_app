"use client";

import * as React from "react";

import { ProductGrid } from "@/components/pos/product-grid";
import { usePosDisplaySettings } from "@/components/pos/use-pos-display-settings";
import { posDisplayCssVars } from "@/lib/pos-display-settings";
import type { PosProduct } from "@/types/pos";

/**
 * The scrolling area of the counter POS catalogue, carrying the display
 * settings as CSS variables (--pos-name-size, --pos-card-min, --pos-img-h,
 * --pos-gap). The variables are set HERE only, on the catalogue wrapper, so
 * they can never reach the cart, the search field, the prices or the buttons.
 * A slider move changes this element's style - the product cards themselves are
 * not re-rendered (see PosProductGrid).
 */
export function PosCatalogScroller({ className, children }: { className?: string; children: React.ReactNode }) {
  const settings = usePosDisplaySettings();
  return (
    <div className={className} style={posDisplayCssVars(settings) as React.CSSProperties}>
      {children}
    </div>
  );
}

type PosProductGridProps = {
  products: PosProduct[];
  onAdd: (productId: string) => boolean | void;
  onAdded?: (product: PosProduct, sourceElement: HTMLElement) => void;
  /** Credit note screen: hide the stock badge / level on the cards (default: shown, as in the POS). */
  showStock?: boolean;
};

/** The counter POS grid in "custom display" mode (the driver POS keeps the plain ProductGrid). */
export function PosProductGrid({ products, onAdd, onAdded, showStock = true }: PosProductGridProps) {
  const { showPhotos } = usePosDisplaySettings();
  return <ProductGrid products={products} onAdd={onAdd} onAdded={onAdded} display={{ showPhotos, showStock }} />;
}
