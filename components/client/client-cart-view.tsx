"use client";

import * as React from "react";
import Link from "next/link";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { ClientCartSummary } from "@/components/client/client-cart-summary";
import { ClientHeader } from "@/components/client/client-header";
import { ProductMedia } from "@/components/products/product-media";
import { cartStorageKey, useClientCart } from "@/lib/client-cart-store";
import { cn, formatCurrency } from "@/lib/utils";
import type { ClientOrganizationIdentityDto, ClientSessionDto } from "@/types/client-portal";

type ClientCartViewProps = {
  client: ClientSessionDto;
  organization: ClientOrganizationIdentityDto;
};

const CHECKOUT_UNAVAILABLE_NOTICE =
  "La validation de commande sera disponible prochainement. Votre panier est conservé.";

export function ClientCartView({ client, organization }: ClientCartViewProps) {
  const { cart, updateQuantity, removeFromCart } = useClientCart(
    cartStorageKey(client.organizationId, client.email),
  );
  const [checkoutNotice, setCheckoutNotice] = React.useState<string | null>(null);

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.priceTTC * line.quantity, 0);

  return (
    <div className="min-h-screen bg-emerald-50/30">
      <ClientHeader client={client} organization={organization} subtitle="Espace Client · Panier" />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Mon panier</h1>
          <p className="text-sm text-muted-foreground">
            {itemCount} article{itemCount > 1 ? "s" : ""}
          </p>
        </div>

        {cart.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-white px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <ShoppingCart aria-hidden="true" className="h-7 w-7" />
            </span>
            <div className="space-y-1">
              <p className="text-lg font-semibold text-foreground">Votre panier est vide</p>
              <p className="text-sm text-muted-foreground">Parcourez le catalogue pour ajouter des produits.</p>
            </div>
            <Link href="/client/catalog" className={cn(buttonVariants({ size: "lg" }), "h-12 bg-emerald-600 px-6 text-white hover:bg-emerald-700")}>
              Découvrir les produits
            </Link>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <ul className="space-y-3">
              {cart.map((line) => (
                <li
                  key={line.productId}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-3.5 shadow-[0_10px_25px_rgba(15,23,42,0.05)] sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <ProductMedia
                      imageUrl={line.imageUrl}
                      alt={line.productName}
                      fit="cover"
                      className="h-20 w-20 shrink-0 rounded-xl"
                    />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium text-foreground">{line.productName}</p>
                      <p className="text-xs text-muted-foreground">{formatCurrency(line.priceTTC)} TTC / unité</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={line.quantity <= 1}
                        onClick={() => updateQuantity(line.productId, line.quantity - 1)}
                        aria-label={`Diminuer la quantité de ${line.productName}`}
                      >
                        <Minus aria-hidden="true" className="h-4 w-4" />
                      </Button>
                      <span className="w-8 text-center text-sm font-medium tabular-nums">{line.quantity}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => updateQuantity(line.productId, line.quantity + 1)}
                        aria-label={`Augmenter la quantité de ${line.productName}`}
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>

                    <p className="w-24 text-right text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(line.priceTTC * line.quantity)}
                    </p>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFromCart(line.productId)}
                      aria-label={`Retirer ${line.productName}`}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            <ClientCartSummary
              itemCount={itemCount}
              total={total}
              checkoutNotice={checkoutNotice}
              onCheckout={() => setCheckoutNotice(CHECKOUT_UNAVAILABLE_NOTICE)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
