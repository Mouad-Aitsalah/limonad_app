"use client";

import * as React from "react";
import { Loader2, PackageSearch, Search, X } from "lucide-react";
import { toast } from "sonner";

import { ClientCartBar, ClientCartSheet } from "@/components/client/client-cart-sheet";
import { ClientHeader } from "@/components/client/client-header";
import { ClientProductCard } from "@/components/client/client-product-card";
import { ClientProductDialog } from "@/components/client/client-product-dialog";
import { useClientCatalog } from "@/components/client/use-client-catalog";
import { cartCounts, cartStorageKey, useClientCart } from "@/lib/client-cart-store";
import { cn } from "@/lib/utils";
import type { ClientCatalogDto, ClientCatalogProductDto, ClientSessionDto } from "@/types/client-portal";

type ClientCatalogViewProps = {
  client: ClientSessionDto;
  catalog: ClientCatalogDto;
};

const CART_FULL_MESSAGE = "Votre panier contient déjà le nombre maximum de produits différents.";

/**
 * Espace Client - the ordering page, mobile first: a compact header + search + categories kept at the top,
 * product cards with an « Ajouter » button that becomes « − n + », a cart bar fixed at the bottom and the
 * cart in a panel over the list (the position in the list is never lost). Search and categories are served
 * by the server (useClientCatalog) and never touch the cart. No price anywhere.
 */
export function ClientCatalogView({ client, catalog }: ClientCatalogViewProps) {
  const { cart, addToCart, updateQuantity } = useClientCart(cartStorageKey(client.organizationId, client.customerId));
  const { search, setSearch, categoryId, setCategoryId, products, nextCursor, loading, error, loadMore } =
    useClientCatalog(catalog.firstPage);
  const [selected, setSelected] = React.useState<ClientCatalogProductDto | null>(null);
  const [cartOpen, setCartOpen] = React.useState(false);

  const quantities = React.useMemo(() => new Map(cart.map((line) => [line.productId, line.quantity])), [cart]);
  const { lineCount, itemCount } = cartCounts(cart);

  function add(product: ClientCatalogProductDto, quantity = 1) {
    if (!addToCart(product, quantity)) toast.error(CART_FULL_MESSAGE);
  }

  function changeQuantity(product: ClientCatalogProductDto, quantity: number) {
    if (quantities.has(product.id)) updateQuantity(product.id, quantity);
    else if (quantity > 0) add(product, quantity);
  }

  const hasFilter = search.trim().length > 0 || categoryId !== null;

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="sticky top-0 z-20 bg-white shadow-[0_4px_16px_rgba(15,23,42,0.05)]">
        <ClientHeader client={client} organization={catalog.organization} active="catalog" onOpenCart={() => setCartOpen(true)} />

        <div className="mx-auto max-w-6xl space-y-2 px-3 pt-2 pb-2.5 sm:px-6">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un produit ou une référence"
              aria-label="Rechercher un produit par désignation ou référence"
              enterKeyHint="search"
              className="h-12 w-full rounded-2xl border border-border bg-slate-50 pr-11 pl-11 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-emerald-400 focus:bg-white focus:ring-3 focus:ring-emerald-500/15 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {loading ? (
              <Loader2 aria-hidden="true" className="absolute top-1/2 right-3.5 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:bg-slate-100"
                aria-label="Effacer la recherche"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {catalog.categories.length > 1 ? (
            <div
              role="tablist"
              aria-label="Catégories"
              className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden"
            >
              <CategoryChip active={categoryId === null} onClick={() => setCategoryId(null)}>
                Tout
              </CategoryChip>
              {catalog.categories.map((category) => (
                <CategoryChip key={category.id} active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>
                  {category.name}
                </CategoryChip>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <main className={cn("mx-auto max-w-6xl px-3 pt-3 sm:px-6 sm:pt-5", lineCount > 0 ? "pb-28" : "pb-8")}>
        {error ? (
          <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {products.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-white px-6 py-12 text-center" data-testid="client-catalog-empty">
            <PackageSearch aria-hidden="true" className="h-10 w-10 text-emerald-600/70" />
            <p className="text-base font-semibold text-foreground">
              {hasFilter ? "Aucun produit ne correspond à votre recherche" : "Aucun produit n'est disponible pour le moment"}
            </p>
            {hasFilter ? (
              <>
                <p className="text-sm text-muted-foreground">Essayez un autre mot, une référence ou une autre catégorie.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCategoryId(null);
                  }}
                  className="mt-1 h-11 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  Voir tous les produits
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <div
            className={cn(
              "grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
              loading && "opacity-60",
            )}
          >
            {products.map((product) => (
              <ClientProductCard
                key={product.id}
                product={product}
                quantityInCart={quantities.get(product.id) ?? 0}
                onAdd={(item) => add(item, 1)}
                onQuantityChange={changeQuantity}
                onOpenDetails={setSelected}
              />
            ))}
          </div>
        )}

        {nextCursor ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-white text-[15px] font-semibold text-foreground hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
            Voir plus de produits
          </button>
        ) : null}
      </main>

      <ClientCartBar lineCount={lineCount} itemCount={itemCount} onOpen={() => setCartOpen(true)} />
      <ClientCartSheet client={client} open={cartOpen} onOpenChange={setCartOpen} />
      <ClientProductDialog
        product={selected}
        quantityInCart={selected ? (quantities.get(selected.id) ?? 0) : 0}
        onClose={() => setSelected(null)}
        onAdd={add}
      />
    </div>
  );
}

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:outline-none",
        active
          ? "bg-emerald-600 text-white shadow-sm"
          : "border border-border bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50",
      )}
    >
      {children}
    </button>
  );
}
