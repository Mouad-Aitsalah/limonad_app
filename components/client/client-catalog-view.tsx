"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientHeader } from "@/components/client/client-header";
import { ClientProductDialog } from "@/components/client/client-product-dialog";
import { useClientCatalog } from "@/components/client/use-client-catalog";
import { ProductMedia } from "@/components/products/product-media";
import { cartStorageKey, useClientCart } from "@/lib/client-cart-store";
import { formatCurrency } from "@/lib/utils";
import type { ClientCatalogDto, ClientCatalogProductDto, ClientSessionDto } from "@/types/client-portal";

type ClientCatalogViewProps = {
  client: ClientSessionDto;
  catalog: ClientCatalogDto;
};

export function ClientCatalogView({ client, catalog }: ClientCatalogViewProps) {
  const { addToCart } = useClientCart(cartStorageKey(client.organizationId, client.customerId));
  const { search, setSearch, categoryId, setCategoryId, products, nextCursor, loading, error, loadMore } =
    useClientCatalog(catalog.firstPage);
  const [selected, setSelected] = React.useState<ClientCatalogProductDto | null>(null);

  function add(product: ClientCatalogProductDto, quantity: number) {
    if (addToCart(product, quantity)) {
      toast.success(`${product.name} × ${quantity} ajouté au panier.`);
    } else {
      toast.error("Votre panier contient déjà le nombre maximum de produits différents.");
    }
  }

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
            placeholder="Rechercher un produit (désignation ou référence)..."
            aria-label="Rechercher un produit"
            className="pl-10"
          />
          {loading ? (
            <Loader2 aria-hidden="true" className="absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {catalog.categories.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCategoryId(null)} className={categoryChipClassName(categoryId === null)}>
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
        ) : null}

        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {products.length === 0 && !loading ? (
          <p className="rounded-2xl border border-dashed border-border bg-white py-12 text-center text-sm text-muted-foreground">
            {search || categoryId ? "Aucun produit ne correspond à votre recherche." : "Aucun produit n'est disponible pour le moment."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <article
                key={product.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-[0_10px_25px_rgba(15,23,42,0.05)]"
              >
                <button
                  type="button"
                  onClick={() => setSelected(product)}
                  className="text-left focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:outline-none"
                  aria-label={`Voir la fiche de ${product.name}`}
                >
                  <ProductMedia imageUrl={product.imageUrl} alt={product.name} fit="cover" className="aspect-square w-full rounded-none" />
                </button>
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <p className="text-xs text-muted-foreground">Réf. {product.reference}</p>
                  <button
                    type="button"
                    onClick={() => setSelected(product)}
                    className="line-clamp-2 min-h-[2.5em] text-left text-sm font-medium text-foreground hover:text-emerald-700"
                  >
                    {product.name}
                  </button>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <span className="font-semibold text-emerald-700 tabular-nums">{formatCurrency(product.priceTTC)}</span>
                    {product.available ? (
                      <Badge variant="secondary">Disponible</Badge>
                    ) : (
                      <Badge variant="outline">Sur commande</Badge>
                    )}
                  </div>
                  <Button type="button" size="sm" className="mt-1 w-full" onClick={() => add(product, 1)}>
                    Ajouter au panier
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

        {nextCursor ? (
          <div className="flex justify-center">
            <Button type="button" variant="outline" onClick={() => void loadMore()} disabled={loading}>
              Voir plus de produits
            </Button>
          </div>
        ) : null}
      </main>

      <ClientProductDialog product={selected} onClose={() => setSelected(null)} onAdd={add} />
    </div>
  );
}

function categoryChipClassName(active: boolean): string {
  return active
    ? "rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition"
    : "rounded-full border border-border bg-white px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:border-emerald-200 hover:bg-emerald-50";
}
