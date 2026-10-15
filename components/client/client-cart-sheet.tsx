"use client";

import * as React from "react";
import { ShoppingCart } from "lucide-react";

import { ClientCartCheckout } from "@/components/client/client-cart-checkout";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ClientSessionDto } from "@/types/client-portal";

type ClientCartSheetProps = {
  client: ClientSessionDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The cart over the catalogue: a bottom panel on a phone, a centred panel on a computer. The list behind it
 * is not reloaded, so the customer finds the same position when the panel closes.
 */
export function ClientCartSheet({ client, open, onOpenChange }: ClientCartSheetProps) {
  const [submitting, setSubmitting] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <DialogContent
        className="top-auto bottom-0 left-0 flex max-h-[90dvh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-t-[28px] rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85vh] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px]"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
        <div className="flex items-center gap-2 px-4 pt-2 pr-14 sm:px-5 sm:pt-5">
          <ShoppingCart aria-hidden="true" className="h-5 w-5 text-emerald-700" />
          <DialogTitle className="font-heading text-lg font-semibold">Mon panier</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Vérifiez les quantités puis confirmez votre commande.</DialogDescription>
        <ClientCartCheckout
          client={client}
          onContinueShopping={() => onOpenChange(false)}
          onSubmittingChange={setSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}

type ClientCartBarProps = {
  lineCount: number;
  itemCount: number;
  onOpen: () => void;
};

/** Fixed at the bottom of the catalogue as soon as the cart holds a product: counts only, never an amount. */
export function ClientCartBar({ lineCount, itemCount, onOpen }: ClientCartBarProps) {
  if (lineCount === 0) return null;
  return (
    <div
      data-testid="client-cart-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-emerald-100 bg-white/95 px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[15px] font-semibold text-foreground">
            {lineCount} produit{lineCount > 1 ? "s" : ""}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {itemCount} article{itemCount > 1 ? "s" : ""} au total
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-emerald-600 px-5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 active:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <ShoppingCart aria-hidden="true" className="h-4 w-4" />
          Voir mon panier
        </button>
      </div>
    </div>
  );
}
