export interface ProductDto {
  id: string;
  reference: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  purchasePrice: number;
  salePrice: number;
  taxRate: number;
  unit: string;
  minimumStock: number;
  status: string;
  imageUrl?: string | null;
  category: {
    id: string;
    name: string;
  };
  brand?: {
    id: string;
    name: string;
  } | null;
  supplier?: {
    id: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export type ProductOptionDto = {
  id: string;
  name: string;
};

/**
 * Phase 3: ProductDto itself was already light (single-level
 * category/brand/supplier selects, no nested arrays) - the fix for
 * /produits is pagination + server-side filters, not a lighter row shape.
 * See getProductsPage's doc comment in lib/server/products.ts.
 */
export interface ProductsPageDto {
  items: ProductDto[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export type ProductMutationInput = {
  reference: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  categoryId: string;
  brandId?: string | null;
  /** Mandatory: a product must always be tied to an active supplier of the same organisation. */
  defaultSupplierId: string;
  purchasePrice: number;
  salePrice: number;
  taxRate: number;
  unit: string;
  minimumStock: number;
  imageUrl?: string | null;
};
