"use client";

import * as React from "react";
import { toast } from "sonner";

import { ProductDialog } from "@/components/produits/product-dialog";
import { ProductsToolbar } from "@/components/produits/products-toolbar";
import { ProductsTable } from "@/components/produits/products-table";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { DataTableShell } from "@/components/ui/data-table-shell";
import type {
  ProductDto,
  ProductMutationInput,
  ProductOptionDto,
} from "@/types/product-dto";

type ProductsViewProps = {
  initialProducts: ProductDto[];
  categories: ProductOptionDto[];
  brands: ProductOptionDto[];
  suppliers: ProductOptionDto[];
};

export function ProductsView({
  initialProducts,
  categories,
  brands,
  suppliers,
}: ProductsViewProps) {
  const [products, setProducts] = React.useState(initialProducts);
  const [search, setSearch] = React.useState("");
  const [categorie, setCategorie] = React.useState("all");
  const [disponibilite, setDisponibilite] = React.useState("all");
  const [editingProduct, setEditingProduct] = React.useState<ProductDto | null>(
    null,
  );
  const [viewingProduct, setViewingProduct] = React.useState<ProductDto | null>(
    null,
  );

  const filteredProducts = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        query.length === 0 ||
        product.name.toLowerCase().includes(query) ||
        product.reference.toLowerCase().includes(query) ||
        (product.barcode?.includes(query) ?? false);

      const matchesCategorie =
        categorie === "all" || product.category.id === categorie;

      const matchesDisponibilite =
        disponibilite === "all" ||
        (disponibilite === "disponible" && product.status === "ACTIVE") ||
        (disponibilite === "indisponible" && product.status !== "ACTIVE");

      return matchesSearch && matchesCategorie && matchesDisponibilite;
    });
  }, [products, search, categorie, disponibilite]);

  async function refreshProducts() {
    const response = await fetch("/api/products", { cache: "no-store" });
    if (!response.ok) {
      toast.error("Impossible de recharger les produits.");
      return;
    }
    const payload = (await response.json()) as { products: ProductDto[] };
    setProducts(payload.products);
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

    const savedProduct = payload.product;
    setProducts((current) =>
      productId
        ? current.map((product) =>
            product.id === savedProduct.id ? savedProduct : product,
          )
        : [savedProduct, ...current],
    );
    toast.success(productId ? "Produit modifie avec succes." : "Produit cree avec succes.");
    setEditingProduct(null);
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

    const updatedProduct = payload.product;
    setProducts((current) =>
      current.map((item) => (item.id === updatedProduct.id ? updatedProduct : item)),
    );
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
        countLabel={`${filteredProducts.length} produit${filteredProducts.length > 1 ? "s" : ""}`}
        toolbar={
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
        }
      >
        <ProductsTable
          products={filteredProducts}
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
