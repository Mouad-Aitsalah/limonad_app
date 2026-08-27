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

export type ProductMutationInput = {
  reference: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  categoryId: string;
  brandId?: string | null;
  defaultSupplierId?: string | null;
  purchasePrice: number;
  salePrice: number;
  taxRate: number;
  unit: string;
  minimumStock: number;
  imageUrl?: string | null;
};
