import type { Metadata } from "next";

import { ProductsImportPreview } from "@/components/produits/products-import-preview";

export const metadata: Metadata = { title: "Import des produits" };

export default function ProduitsImportPage() {
  return <ProductsImportPreview />;
}
