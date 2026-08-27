import type { Metadata } from "next";

import { ProductsView } from "@/components/produits/products-view";
import {
  getBrands,
  getCategories,
  getProducts,
  getSuppliers,
} from "@/lib/server/products";

export const metadata: Metadata = {
  title: "Produits",
};

export default async function ProduitsPage() {
  const [products, categories, brands, suppliers] = await Promise.all([
    getProducts(),
    getCategories(),
    getBrands(),
    getSuppliers(),
  ]);

  return (
    <ProductsView
      initialProducts={products}
      categories={categories}
      brands={brands}
      suppliers={suppliers}
    />
  );
}
