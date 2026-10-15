"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Info, Loader2, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ClientQuantityStepper } from "@/components/client/client-quantity-stepper";
import { useClientOrderSubmit } from "@/components/client/use-client-order-submit";
import { ProductMedia } from "@/components/products/product-media";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cartCounts, cartStorageKey, useClientCart } from "@/lib/client-cart-store";
import { cn } from "@/lib/utils";
import type { ClientCartLine, ClientOrderSummaryDto, ClientSessionDto } from "@/types/client-portal";

type ClientCartCheckoutProps = {
  client: ClientSessionDto;
  /** Back to the products (closes the catalogue panel, or leaves the cart page). */
  onContinueShopping: () => void;
  /** The panel must not close while the order is being sent. */
  onSubmittingChange?: (submitting: boolean) => void;
};

type Step = "cart" | "confirm";

/**
 * The whole ordering path after the product choice, in ONE component used by the catalogue's cart panel and
 * by the /client/cart page: 1. the cart (quantities, remove) -> 2. confirmation (who orders, optional note)
 * -> sent. Nothing about prices: the server prices the order. The submission is guarded against double taps
 * and retries (useClientOrderSubmit), and the customer's identity comes from the session - nothing to retype.
 */
export function ClientCartCheckout({ client, onContinueShopping, onSubmittingChange }: ClientCartCheckoutProps) {
  const { cart, updateQuantity, removeFromCart, clearCart } = useClientCart(
    cartStorageKey(client.organizationId, client.customerId),
  );
  const { submit, submitting } = useClientOrderSubmit();
  const [step, setStep] = React.useState<Step>("cart");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sentOrder, setSentOrder] = React.useState<ClientOrderSummaryDto | null>(null);
  const { lineCount, itemCount } = cartCounts(cart);

  React.useEffect(() => {
    onSubmittingChange?.(submitting);
  }, [submitting, onSubmittingChange]);

  async function confirm() {
    setError(null);
    const outcome = await submit(cart, note);
    if (outcome.kind === "busy") return;
    if (outcome.kind === "created") {
      clearCart();
      setNote("");
      setStep("cart");
      setSentOrder(outcome.order);
      return;
    }
    if (outcome.kind === "unavailable") {
      removeFromCart(outcome.productIds);
      setStep("cart");
      setError(outcome.message);
      toast.error(outcome.message);
      return;
    }
    setError(outcome.message);
    toast.error(outcome.message);
  }

  if (sentOrder) {
    return (
      <div className="flex flex-col items-center gap-4 px-5 py-10 text-center" data-testid="client-order-sent">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 aria-hidden="true" className="h-9 w-9" />
        </span>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-foreground">Commande {sentOrder.orderNumber} envoyée</p>
          <p className="text-sm text-muted-foreground">
            {sentOrder.itemCount} article{sentOrder.itemCount > 1 ? "s" : ""} · Votre fournisseur va la traiter.
          </p>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-2">
          <button type="button" onClick={onContinueShopping} className={primaryButtonClass}>
            Continuer mes achats
          </button>
          <Link href="/client/orders" className={secondaryButtonClass}>
            Suivre mes commandes
          </Link>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 px-5 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <ShoppingCart aria-hidden="true" className="h-7 w-7" />
        </span>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-foreground">Votre panier est vide</p>
          <p className="text-sm text-muted-foreground">Ajoutez des produits depuis le catalogue.</p>
        </div>
        {error ? <ErrorNote message={error} /> : null}
        <button type="button" onClick={onContinueShopping} className={cn(primaryButtonClass, "max-w-sm")}>
          Voir les produits
        </button>
      </div>
    );
  }

  const counts = `${lineCount} produit${lineCount > 1 ? "s" : ""} · ${itemCount} article${itemCount > 1 ? "s" : ""}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 pt-4 pb-3 sm:px-5">
        <StepDot active={step === "cart"} done={step === "confirm"} label="1. Panier" />
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <StepDot active={step === "confirm"} done={false} label="2. Confirmation" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        {error ? <ErrorNote message={error} /> : null}
        {step === "cart" ? (
          <>
            <p className="mb-2 text-sm font-medium text-muted-foreground" data-testid="client-cart-counts">
              {counts}
            </p>
            <ul className="divide-y divide-border">
              {cart.map((line) => (
                <CartLineRow
                  key={line.productId}
                  line={line}
                  onQuantityChange={(quantity) => updateQuantity(line.productId, quantity)}
                  onRemove={() => removeFromCart(line.productId)}
                />
              ))}
            </ul>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50/70 px-4 py-3 text-sm">
              <p className="font-semibold text-foreground">
                {client.customerName} <span className="font-normal text-muted-foreground">({client.customerDisplayCode})</span>
              </p>
              {client.contactPhone ? <p className="text-muted-foreground">Contact : {client.contactPhone}</p> : null}
              <p className="mt-1 text-muted-foreground">{counts}</p>
            </div>
            <ul className="space-y-1.5 text-sm" aria-label="Récapitulatif de la commande">
              {cart.map((line) => (
                <li key={line.productId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-foreground">{line.productName}</span>
                  <span className="shrink-0 font-semibold tabular-nums">× {line.quantity}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5">
              <Label htmlFor="client-order-note">
                Note pour le fournisseur <span className="font-normal text-muted-foreground">(facultatif)</span>
              </Label>
              <Textarea
                id="client-order-note"
                maxLength={500}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ex. livraison le matin"
                disabled={submitting}
              />
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Votre fournisseur valide la commande puis établit la facture.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
        {step === "cart" ? (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => { setError(null); setStep("confirm"); }} className={primaryButtonClass}>
              Continuer ma commande
            </button>
            <button type="button" onClick={onContinueShopping} className={secondaryButtonClass}>
              Ajouter d&apos;autres produits
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("cart")}
              disabled={submitting}
              className={cn(secondaryButtonClass, "w-auto shrink-0 px-4")}
              aria-label="Retour au panier"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => void confirm()} disabled={submitting} className={primaryButtonClass}>
              {submitting ? (
                <>
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Envoi en cours…
                </>
              ) : (
                "Confirmer et envoyer"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 active:bg-emerald-800 disabled:pointer-events-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:outline-none";
const secondaryButtonClass =
  "flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-white px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:outline-none";

function CartLineRow({
  line,
  onQuantityChange,
  onRemove,
}: {
  line: ClientCartLine;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex gap-3 py-3" data-testid="client-cart-line">
      <ProductMedia imageUrl={line.imageUrl} alt={line.productName} fit="cover" sizes="64px" className="h-16 w-16 shrink-0 rounded-xl bg-slate-50" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm leading-tight font-semibold text-foreground">{line.productName}</p>
            {line.reference ? <p className="mt-0.5 truncate text-xs text-muted-foreground">Réf. {line.reference}</p> : null}
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="-mt-1 -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500/30 focus-visible:outline-none"
            aria-label={`Retirer ${line.productName}`}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <ClientQuantityStepper value={line.quantity} onChange={onQuantityChange} label={line.productName} />
      </div>
    </li>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold",
        active ? "bg-emerald-600 text-white" : done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
      )}
      aria-current={active ? "step" : undefined}
    >
      {label}
    </span>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}
