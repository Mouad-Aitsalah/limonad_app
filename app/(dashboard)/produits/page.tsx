import type { Metadata } from "next";

import { ProductsView } from "@/components/produits/products-view";
import {
  getBrands,
  getCategories,
  getProductsPage,
  getSuppliers,
} from "@/lib/server/products";

export const metadata: Metadata = {
  title: "Produits",
};

export default async function ProduitsPage() {
  const [initialPage, categories, brands, suppliers] = await Promise.all([
    getProductsPage(),
    getCategories(),
    getBrands(),
    getSuppliers(),
  ]);

  return (
    <ProductsView
      initialPage={initialPage}
      categories={categories}
      brands={brands}
      suppliers={suppliers}
    />
  );
}
