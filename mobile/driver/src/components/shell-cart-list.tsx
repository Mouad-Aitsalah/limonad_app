import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { formatCurrency } from "@/lib/utils";

import type { CartLineComputed } from "../lib/cart-types";

/**
 * BUG-04 "DERNIER AJUSTEMENT VISUEL DU PANIER MOBILE" - "1./2. PAS DE
 * TABLEAU SUR PETIT ÉCRAN".
 *
 * `components/pos/cart-table.tsx` (a real <table>, PRODUIT/QTE/PRIX/REM.
 * columns) is shared with the web app's own POS screens (counter + web
 * driver POS) - it is NOT edited here, so nothing about that shared,
 * already-validated experience changes. This is a SHELL-ONLY sibling: same
 * `CartLineComputed` data (../lib/cart-types.ts, itself a pure data-shape
 * copy carrying no business logic - see that file's own doc comment) and
 * the exact same increment/decrement/quantity/remove callback contract
 * PosScreen already wires to CartTable, so swapping the import is the only
 * change needed there - every calculation (quantities, unit price, line
 * total, VAT, discount) still comes from PosScreen's own computeLine/
 * cartRows, completely untouched. A vertical list of cards, one per line,
 * replaces the column layout - built for this shell's real width
 * (~360-412px, phone-only), never a resized-desktop fallback.
 */

export type ShellCartListProps = {
  lines: CartLineComputed[];
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
};

export function ShellCartList({ lines, onIncrement, onDecrement, onQuantityChange, onRemove }: ShellCartListProps) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
        <ShoppingCart aria-hidden="true" className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Le panier est vide.</p>
        <p className="text-xs text-muted-foreground/70">Touchez un produit pour l&apos;ajouter.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {lines.map((line) => (
        <ShellCartRow
          key={line.productId}
          line={line}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
          onQuantityChange={onQuantityChange}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function ShellCartRow({
  line,
  onIncrement,
  onDecrement,
  onQuantityChange,
  onRemove,
}: { line: CartLineComputed } & Omit<ShellCartListProps, "lines">) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-medium break-words text-foreground">{line.designation}</p>
          {line.reference ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{line.reference}</p> : null}
        </div>
        <button
          type="button"
          aria-label={`Retirer ${line.designation} du panier`}
          onClick={() => onRemove(line.productId)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 active:bg-red-50"
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Diminuer la quantite"
            onClick={() => onDecrement(line.productId)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-input bg-background text-foreground transition-colors active:bg-accent"
          >
            <Minus aria-hidden="true" className="h-4 w-4" />
          </button>
          <input
            type="number"
            min={1}
            value={line.quantity}
            onFocus={(event) => requestAnimationFrame(() => event.currentTarget.select())}
            onChange={(event) => onQuantityChange(line.productId, Math.max(1, Number(event.target.value)))}
            aria-label={`Quantite de ${line.designation}`}
            className="h-10 w-12 rounded-xl border border-input bg-background text-center text-base font-medium outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
          />
          <button
            type="button"
            aria-label="Augmenter la quantite"
            onClick={() => onIncrement(line.productId)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-input bg-background text-foreground transition-colors active:bg-accent"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <p className="shrink-0 text-right text-xs text-muted-foreground">
          {formatCurrency(line.unitPriceTTC)} × {line.quantity}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">Total ligne</span>
        <span className="text-base font-bold tabular-nums text-foreground">{formatCurrency(line.totalTTC)}</span>
      </div>
    </div>
  );
}
