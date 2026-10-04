"use client";

import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";

type ClientCartSummaryProps = {
  itemCount: number;
  total: number;
  /**
   * Called when the client presses "Passer commande". Orders are not
   * implemented yet: the parent only shows an informational notice. Wiring a
   * real order submission later means changing this callback (and
   * `checkoutNotice`) only - the summary itself needs no change.
   */
  onCheckout: () => void;
  checkoutNotice: string | null;
};

export function ClientCartSummary({ itemCount, total, onCheckout, checkoutNotice }: ClientCartSummaryProps) {
  return (
    <aside className="h-fit space-y-4 rounded-2xl border border-border bg-white p-5 shadow-[0_10px_25px_rgba(15,23,42,0.05)] lg:sticky lg:top-24">
      <h2 className="font-heading text-lg font-semibold text-foreground">Récapitulatif</h2>

      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Articles</dt>
          <dd className="tabular-nums">{itemCount}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
          <dt>Total TTC</dt>
          <dd className="tabular-nums text-emerald-700">{formatCurrency(total)}</dd>
        </div>
      </dl>

      <Button type="button" size="lg" className="h-12 w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={onCheckout}>
        Passer commande
      </Button>

      {checkoutNotice ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {checkoutNotice}
        </p>
      ) : null}

      <Link href="/client/catalog" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 w-full")}>
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Continuer mes achats
      </Link>
    </aside>
  );
}
