"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string>(ALL_CATEGORIES);
  const [cartOpen, setCartOpen] = React.useState(false);
  const { cart, addToCart, updateQuantity, removeFromCart } = useClientCart(
    cartStorageKey(client.organizationId, client.email),
  );

  const organizationName = catalog.organization.tradeName?.trim() || catalog.organization.name;

  const filteredProducts = React.useMemo(() => {
    const query = normalize(search);
    return catalog.products.filter((product) => {
      if (categoryId !== ALL_CATEGORIES && product.categoryId !== categoryId) return false;
      if (query && !normalize(product.name).includes(query)) return false;
      return true;
    });
  }, [catalog.products, search, categoryId]);

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce((sum, line) => sum + line.priceTTC * line.quantity, 0);

  async function handleLogout() {
    await fetch("/api/client/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/client/login");
  }

  return (
    <div className="min-h-screen bg-emerald-50/30">
      <header className="sticky top-0 z-20 border-b border-emerald-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {catalog.organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={catalog.organization.logoUrl}
                alt={organizationName}
                className="h-10 w-10 rounded-xl object-contain"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">
                {organizationName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate font-heading text-lg font-semibold text-foreground">
                {organizationName}
              </p>
              <p className="truncate text-xs text-muted-foreground">Espace Client · Catalogue</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setCartOpen(true)} className="relative">
              <ShoppingCart aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Panier</span>
              {cartCount > 0 ? (
                <Badge className="ml-1 bg-emerald-600 text-white">{cartCount}</Badge>
              ) : null}
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={handleLogout} aria-label="Se déconnecter">
              <LogOut aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

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

      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Votre panier</DialogTitle>
            <DialogDescription>
              {cartCount > 0
                ? `${cartCount} article${cartCount > 1 ? "s" : ""}`
                : "Votre panier est vide."}
            </DialogDescription>
          </DialogHeader>

          {cart.length > 0 ? (
            <div className="flex-1 space-y-3 overflow-y-auto px-1 py-1">
              {cart.map((line) => (
                <div
                  key={line.productId}
                  className="flex items-center gap-3 rounded-xl border border-border p-2.5"
                >
                  <ProductMedia
                    imageUrl={line.imageUrl}
                    alt={line.productName}
                    fit="cover"
                    className="h-14 w-14 shrink-0 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{line.productName}</p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(line.priceTTC)}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      onClick={() => updateQuantity(line.productId, line.quantity - 1)}
                      aria-label="Diminuer la quantité"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      onClick={() => updateQuantity(line.productId, line.quantity + 1)}
                      aria-label="Augmenter la quantité"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeFromCart(line.productId)}
                    aria-label={`Retirer ${line.productName}`}
                    className="text-muted-foreground hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter className="flex-col gap-3 sm:flex-col">
            <div className="flex w-full items-center justify-between border-t border-border pt-3 text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(cartTotal)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              La validation de commande sera disponible dans une prochaine étape.
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function categoryChipClassName(active: boolean): string {
  return active
    ? "rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition"
    : "rounded-full border border-border bg-white px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:border-emerald-200 hover:bg-emerald-50";
}
