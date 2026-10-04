"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientHeader } from "@/components/client/client-header";
import { ProductMedia } from "@/components/products/product-media";
import { cartStorageKey, useClientCart } from "@/lib/client-cart-store";
import { formatCurrency } from "@/lib/utils";
import type { ClientCatalogDto, ClientSessionDto } from "@/types/client-portal";

type ClientCatalogViewProps = {
  client: ClientSessionDto;
  catalog: ClientCatalogDto;
};

const ALL_CATEGORIES = "__all__";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function ClientCatalogView({ client, catalog }: ClientCatalogViewProps) {
  const [search, setSearch] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string>(ALL_CATEGORIES);
  const { addToCart } = useClientCart(cartStorageKey(client.organizationId, client.email));

  const filteredProducts = React.useMemo(() => {
    const query = normalize(search);
    return catalog.products.filter((product) => {
      if (categoryId !== ALL_CATEGORIES && product.categoryId !== categoryId) return false;
      if (query && !normalize(product.name).includes(query)) return false;
      return true;
    });
  }, [catalog.products, search, categoryId]);

  return (
    <div className="min-h-screen bg-emerald-50/30">
      <ClientHeader client={client} organization={catalog.organization} subtitle="Espace Client · Catalogue" />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un produit..."
            className="pl-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoryId(ALL_CATEGORIES)}
            className={categoryChipClassName(categoryId === ALL_CATEGORIES)}
          >
            Toutes les catégories
          </button>
          {catalog.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setCategoryId(category.id)}
              className={categoryChipClassName(categoryId === category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>

        {filteredProducts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-white py-12 text-center text-sm text-muted-foreground">
            Aucun produit ne correspond à votre recherche.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-[0_10px_25px_rgba(15,23,42,0.05)]"
              >
                <ProductMedia
                  imageUrl={product.imageUrl}
                  alt={product.name}
                  fit="cover"
                  className="aspect-square w-full rounded-none"
                />
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <p className="text-xs text-muted-foreground">{product.categoryName}</p>
                  <p className="line-clamp-2 min-h-[2.5em] text-sm font-medium text-foreground">
                    {product.name}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <span className="font-semibold text-emerald-700">
                      {formatCurrency(product.priceTTC)}
                    </span>
                    {product.available ? (
                      <Badge variant="secondary">En stock</Badge>
                    ) : (
                      <Badge variant="destructive">Rupture</Badge>
                    )}
                  </div>
                  <Button type="button" size="sm" className="mt-1 w-full" onClick={() => addToCart(product)}>
                    Ajouter au panier
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function categoryChipClassName(active: boolean): string {
  return active
    ? "rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition"
    : "rounded-full border border-border bg-white px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:border-emerald-200 hover:bg-emerald-50";
}
