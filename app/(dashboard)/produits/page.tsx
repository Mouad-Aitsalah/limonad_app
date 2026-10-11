import type { Metadata } from "next";

import { ProductsView } from "@/components/produits/products-view";
import {
  getBrands,
  getCategories,
  getProductsPage,
  getSuppliers,
} from "@/lib/server/products";
import { getProductColumnSettings } from "@/lib/server/organization-settings";

export const metadata: Metadata = {
  title: "Produits",
};

export default async function ProduitsPage() {
  const [initialPage, categories, brands, suppliers, columns] = await Promise.all([
    // withStock: the "Quantité en stock" column (one grouped query per page).
    getProductsPage({ withStock: true }),
    getCategories(),
    getBrands(),
    getSuppliers(),
    getProductColumnSettings(),
  ]);

  return (
    <ProductsView
      initialPage={initialPage}
      categories={categories}
      brands={brands}
      suppliers={suppliers}
      initialColumnSettings={columns.settings}
      canEditColumns={columns.canEdit}
    />
  );
}
