"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { ClientCartSummary } from "@/components/client/client-cart-summary";
import { ClientHeader } from "@/components/client/client-header";
import { ClientOrderConfirmDialog } from "@/components/client/client-order-confirm-dialog";
import { ClientQuantityStepper } from "@/components/client/client-quantity-stepper";
import { useClientOrderSubmit } from "@/components/client/use-client-order-submit";
import { ProductMedia } from "@/components/products/product-media";
import { cartStorageKey, useClientCart } from "@/lib/client-cart-store";
import { estimateClientCartTotal } from "@/lib/client-portal-rules";
import { cn, formatCurrency } from "@/lib/utils";
import type { ClientOrderSummaryDto, ClientOrganizationIdentityDto, ClientSessionDto } from "@/types/client-portal";

type ClientCartViewProps = {
  client: ClientSessionDto;
  organization: ClientOrganizationIdentityDto;
};

export function ClientCartView({ client, organization }: ClientCartViewProps) {
  const { cart, updateQuantity, removeFromCart, applyPrices, clearCart } = useClientCart(
    cartStorageKey(client.organizationId, client.customerId),
  );
  const { submit, submitting } = useClientOrderSubmit();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [sentOrder, setSentOrder] = React.useState<ClientOrderSummaryDto | null>(null);

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = estimateClientCartTotal(cart).totalTTC;

  async function handleConfirm(note: string) {
    const outcome = await submit(cart, total, note);
    if (outcome.kind === "created") {
      clearCart();
      setConfirmOpen(false);
      setSentOrder(outcome.order);
      return;
    }
    if (outcome.kind === "price_changed") {
      applyPrices(outcome.prices);
      toast.warning(outcome.message);
      return; // dialog stays open with the new prices and total
    }
    if (outcome.kind === "unavailable") {
      removeFromCart(outcome.productIds);
      setConfirmOpen(false);
      toast.error(outcome.message);
      return;
    }
    toast.error(outcome.message);
  }

  return (
    <div className="min-h-screen bg-emerald-50/30">
      <ClientHeader client={client} organization={organization} subtitle="Espace Client · Panier" />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {sentOrder ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-emerald-200 bg-white px-6 py-14 text-center">
            <CheckCircle2 aria-hidden="true" className="h-12 w-12 text-emerald-600" />
            <div className="space-y-1">
              <p className="text-lg font-semibold text-foreground">Commande {sentOrder.orderNumber} envoyée</p>
              <p className="text-sm text-muted-foreground">
                {sentOrder.itemCount} article{sentOrder.itemCount > 1 ? "s" : ""} · total estimé{" "}
                {formatCurrency(sentOrder.totalTTC)}. Votre fournisseur va la traiter.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/client/orders" className={cn(buttonVariants({ variant: "outline" }))}>
                Voir mes commandes
              </Link>
              <Link href="/client/catalog" className={cn(buttonVariants(), "bg-emerald-600 text-white hover:bg-emerald-700")}>
                Retour au catalogue
              </Link>
            </div>
          </div>
        ) : (
          <>
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
                <Link
                  href="/client/catalog"
                  className={cn(buttonVariants({ size: "lg" }), "h-12 bg-emerald-600 px-6 text-white hover:bg-emerald-700")}
                >
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
                          <p className="text-xs text-muted-foreground">
                            {line.reference ? `Réf. ${line.reference} · ` : ""}
                            {formatCurrency(line.priceTTC)} TTC / unité
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <ClientQuantityStepper
                          value={line.quantity}
                          onChange={(quantity) => updateQuantity(line.productId, quantity)}
                          label={line.productName}
                        />
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
                  onCheckout={() => setConfirmOpen(true)}
                  disabled={submitting}
                />
              </div>
            )}
          </>
        )}
      </main>

      <ClientOrderConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        cart={cart}
        total={total}
        customerName={client.customerName}
        contactPhone={client.contactPhone}
        submitting={submitting}
        onConfirm={(note) => void handleConfirm(note)}
      />
    </div>
  );
}
