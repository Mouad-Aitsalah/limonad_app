"use client";

import * as React from "react";
import { toast } from "sonner";

import { CategoriesTable } from "@/components/categories/categories-table";
import { CategoriesToolbar } from "@/components/categories/categories-toolbar";
import { CategoryDialog } from "@/components/categories/category-dialog";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { DataTableShell } from "@/components/ui/data-table-shell";
import type { CategoryListItem, CategoryMutationInput } from "@/types/category";

type CategoriesViewProps = {
  initialCategories: CategoryListItem[];
};

export function CategoriesView({ initialCategories }: CategoriesViewProps) {
  const [categories, setCategories] = React.useState(initialCategories);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [editingCategory, setEditingCategory] = React.useState<CategoryListItem | null>(null);
  const [viewingCategory, setViewingCategory] = React.useState<CategoryListItem | null>(null);

  const filteredCategories = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    return categories.filter((category) => {
      const matchesSearch =
        query.length === 0 ||
        (category.code ?? "").toLowerCase().includes(query) ||
        category.name.toLowerCase().includes(query);

      const matchesStatus =
        status === "all" ||
        (status === "ACTIVE" && category.active) ||
        (status === "INACTIVE" && !category.active);

      return matchesSearch && matchesStatus;
    });
  }, [categories, search, status]);

  async function saveCategory(
    values: CategoryMutationInput,
    categoryId?: string,
  ): Promise<Record<string, string> | null> {
    const response = await fetch(
      categoryId ? `/api/categories/${categoryId}` : "/api/categories",
      {
        method: categoryId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );
    const payload = (await response.json()) as {
      category?: CategoryListItem;
      message?: string;
      fieldErrors?: Record<string, string>;
    };

    if (!response.ok || !payload.category) {
      toast.error(payload.message ?? "Impossible d'enregistrer la categorie.");
      return payload.fieldErrors ?? { form: payload.message ?? "Erreur inconnue." };
    }

    const savedCategory = payload.category;
    setCategories((current) =>
      categoryId
        ? current.map((category) =>
            category.id === savedCategory.id ? savedCategory : category,
          )
        : [savedCategory, ...current],
    );
    toast.success(categoryId ? "Categorie modifiee avec succes." : "Categorie creee avec succes.");
    setEditingCategory(null);
    return null;
  }

  async function toggleStatus(category: CategoryListItem) {
    const response = await fetch(`/api/categories/${category.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !category.active }),
    });
    const payload = (await response.json()) as {
      category?: CategoryListItem;
      message?: string;
    };

    if (!response.ok || !payload.category) {
      toast.error(payload.message ?? "Impossible de modifier le statut.");
      return;
    }

    const updatedCategory = payload.category;
    setCategories((current) =>
      current.map((item) => (item.id === updatedCategory.id ? updatedCategory : item)),
    );
    toast.success(updatedCategory.active ? "Categorie activee." : "Categorie desactivee.");
  }

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Catalogue"
        title="Categories"
        description="Organisez le catalogue COMDIS et pilotez rapidement l'activation des familles de produits."
        actions={<CategoryDialog onSave={saveCategory} />}
      />

      <DataTableShell
        title="Structure du catalogue"
        description="Recherche, statuts et actions rapides sur les categories."
        countLabel={`${filteredCategories.length} categorie${filteredCategories.length > 1 ? "s" : ""}`}
        toolbar={
          <CategoriesToolbar
            search={search}
            onSearchChange={setSearch}
            status={status}
            onStatusChange={setStatus}
          />
        }
      >
        <CategoriesTable
          categories={filteredCategories}
          onView={setViewingCategory}
          onEdit={setEditingCategory}
          onToggleStatus={toggleStatus}
        />
      </DataTableShell>

      <CategoryDialog
        category={editingCategory}
        open={editingCategory !== null}
        onOpenChange={(open) => {
          if (!open) setEditingCategory(null);
        }}
        onSave={saveCategory}
      />

      <CategoryDialog
        category={viewingCategory}
        mode="view"
        open={viewingCategory !== null}
        onOpenChange={(open) => {
          if (!open) setViewingCategory(null);
        }}
        onSave={saveCategory}
      />
    </div>
  );
}
