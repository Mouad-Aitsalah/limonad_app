import type { Metadata } from "next";

import { CategoriesView } from "@/components/categories/categories-view";
import { getCategories } from "@/lib/server/categories";

export const metadata: Metadata = {
  title: "Catégories",
};

export default async function CategoriesPage() {
  const payload = await getCategories();

  return <CategoriesView initialCategories={payload.items} />;
}
