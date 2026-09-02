"use client";

import * as React from "react";
import { toast } from "sonner";

import { ProductDialog } from "@/components/produits/product-dialog";
import { ProductsToolbar } from "@/components/produits/products-toolbar";
import { ProductsTable } from "@/components/produits/products-table";
import { useProductsPage } from "@/components/produits/use-products-page";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { Button } from "@/components/ui/button";
import { DataTableShell } from "@/components/ui/data-table-shell";
import type {
  ProductDto,
  ProductMutationInput,
  ProductOptionDto,
  ProductsPageDto,
} from "@/types/product-dto";

const PRODUCTS_SEARCH_DEBOUNCE_MS = 400;

type ProductsViewProps = {
  initialPage: ProductsPageDto;
  categories: ProductOptionDto[];
  brands: ProductOptionDto[];
  suppliers: ProductOptionDto[];
};

export function ProductsView({
  initialPage,
  categories,
  brands,
  suppliers,
}: ProductsViewProps) {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), PRODUCTS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const [categorie, setCategorie] = React.useState("all");
  const [disponibilite, setDisponibilite] = React.useState("all");
  const [editingProduct, setEditingProduct] = React.useState<ProductDto | null>(
    null,
  );
  const [viewingProduct, setViewingProduct] = React.useState<ProductDto | null>(
    null,
  );

  const {
    items: products,
    totalCount,
    pageIndex,
    hasMore,
    hasPrevious,
    loading,
    goToNextPage,
    goToPreviousPage,
    refetchCurrentPage,
    resetToFirstPage,
  } = useProductsPage(
    {
      search: debouncedSearch,
      categoryId: categorie,
      status: disponibilite === "disponible" ? "ACTIVE" : disponibilite === "indisponible" ? "INACTIVE" : "all",
    },
    initialPage,
  );

  async function refreshProducts() {
    await refetchCurrentPage();
  }

  async function saveProduct(
    values: ProductMutationInput,
    productId?: string,
  ): Promise<Record<string, string> | null> {
    const response = await fetch(
      productId ? `/api/products/${productId}` : "/api/products",
      {
        method: productId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );
    const payload = (await response.json()) as {
      product?: ProductDto;
      message?: string;
      fieldErrors?: Record<string, string>;
    };

    if (!response.ok || !payload.product) {
      toast.error(payload.message ?? "Impossible d'enregistrer le produit.");
      return payload.fieldErrors ?? { form: payload.message ?? "Erreur inconnue." };
    }

    toast.success(productId ? "Produit modifie avec succes." : "Produit cree avec succes.");
    setEditingProduct(null);
    // A new product sorts first (createdAt desc) - jump back to page 1 so it
    // is immediately visible. An edit only needs the current page refreshed.
    if (productId) {
      await refetchCurrentPage();
    } else {
      await resetToFirstPage();
    }
    return null;
  }

  async function toggleStatus(product: ProductDto) {
    const active = product.status !== "ACTIVE";
    const response = await fetch(`/api/products/${product.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const payload = (await response.json()) as {
      product?: ProductDto;
      message?: string;
    };

    if (!response.ok || !payload.product) {
      toast.error(payload.message ?? "Impossible de modifier le statut.");
      return;
    }

    await refetchCurrentPage();
    toast.success(active ? "Produit active." : "Produit desactive.");
  }

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Catalogue"
        title="Produits"
        description="Pilotez le catalogue COMDIS, les prix, les statuts et les visuels produits depuis une vue unique."
        actions={
          <ProductDialog
            categories={categories}
            brands={brands}
            suppliers={suppliers}
            onSave={saveProduct}
            onRefresh={refreshProducts}
          />
        }
      />

      <DataTableShell
        title="Catalogue produits"
        description="Recherche, filtres et actions rapides sur l'ensemble des references."
        countLabel={`Page ${pageIndex + 1} · ${products.length} sur cette page · ${totalCount} au total`}
        toolbar={
          <div className="space-y-3">
            <ProductsToolbar
              search={search}
              onSearchChange={setSearch}
              categorie={categorie}
              onCategorieChange={setCategorie}
              categories={categories.map((category) => ({
                value: category.id,
                label: category.name,
              }))}
              disponibilite={disponibilite}
              onDisponibiliteChange={setDisponibilite}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasPrevious || loading}
                onClick={goToPreviousPage}
              >
                Precedent
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasMore || loading}
                onClick={goToNextPage}
              >
                Suivant
              </Button>
            </div>
          </div>
        }
      >
        <ProductsTable
          products={products}
          onView={setViewingProduct}
          onEdit={setEditingProduct}
          onToggleStatus={toggleStatus}
        />
      </DataTableShell>

      <ProductDialog
        product={editingProduct}
        categories={categories}
        brands={brands}
        suppliers={suppliers}
        open={editingProduct !== null}
        onOpenChange={(open) => {
          if (!open) setEditingProduct(null);
        }}
        onSave={saveProduct}
        onRefresh={refreshProducts}
      />

      <ProductDialog
        product={viewingProduct}
        mode="view"
        categories={categories}
        brands={brands}
        suppliers={suppliers}
        open={viewingProduct !== null}
        onOpenChange={(open) => {
          if (!open) setViewingProduct(null);
        }}
        onSave={saveProduct}
        onRefresh={refreshProducts}
      />
    </div>
  );
}
