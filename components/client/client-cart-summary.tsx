"use client";

import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";

type ClientCartSummaryProps = {
  itemCount: number;
  /** Estimated total, computed exactly like the POS (commercial rounding to 0.50 DH included). */
  total: number;
  /** Opens the order confirmation. */
  onCheckout: () => void;
  disabled?: boolean;
};

export function ClientCartSummary({ itemCount, total, onCheckout, disabled = false }: ClientCartSummaryProps) {
  return (
    <aside className="h-fit space-y-4 rounded-2xl border border-border bg-white p-5 shadow-[0_10px_25px_rgba(15,23,42,0.05)] lg:sticky lg:top-24">
      <h2 className="font-heading text-lg font-semibold text-foreground">Récapitulatif</h2>

      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Articles</dt>
          <dd className="tabular-nums">{itemCount}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
          <dt>Total estimé TTC</dt>
          <dd className="tabular-nums text-emerald-700">{formatCurrency(total)}</dd>
        </div>
      </dl>

      <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-xs text-emerald-800">
        <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Montant indicatif : la facture définitive est établie par votre fournisseur après validation de la commande.
      </p>

      <Button
        type="button"
        size="lg"
        className="h-12 w-full bg-emerald-600 text-white hover:bg-emerald-700"
        onClick={onCheckout}
        disabled={disabled}
      >
        Passer commande
      </Button>

      <Link href="/client/catalog" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 w-full")}>
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Continuer mes achats
      </Link>
    </aside>
  );
}
