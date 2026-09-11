import type { FocusEvent } from "react";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { CartLineComputed } from "@/components/pos/pos-layout";
import type { PosOperationType } from "@/types/pos";

/**
 * Select the whole current value the moment an editable numeric cell gets
 * focus (click, tab or tap), so the operator can overwrite "72" by just
 * typing "60" - no manual clearing. rAF because iOS Safari drops a
 * selection made synchronously inside onFocus.
 */
function selectAllOnFocus(event: FocusEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  requestAnimationFrame(() => {
    try {
      input.select();
    } catch {
      // input detached before the frame ran - nothing to do
    }
  });
}

type CartTableProps = {
  lines: CartLineComputed[];
  operationType: PosOperationType;
  readOnly?: boolean;
  /** Admin-only: turn the "Prix TTC" cell into an editable per-line input. */
  canEditPrice?: boolean;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  /** DH taken off the unit's TTC price - see lib/pos-discount.ts. */
  onDiscountChange: (productId: string, discountUnitAmount: number) => void;
  onPriceChange?: (productId: string, unitPriceTTC: number | null) => void;
  onRemove: (productId: string) => void;
};

// Column widths are the single source of truth (`table-fixed` makes every
// <td> take its <th> width exactly). Two regimes:
//  - MOBILE (< lg): percentages that sum to 100% -> the whole table fits the
//    cart panel, no internal horizontal scroll, all 5 columns visible.
//  - DESKTOP (lg+): the previously-validated fixed rem widths, untouched.
const COL = {
  produit: "w-[28%] px-1 lg:w-auto lg:px-4",
  qte: "w-[26%] px-0.5 lg:w-[7.5rem] lg:px-2",
  prix: "w-[15%] px-0.5 lg:w-24 lg:px-2",
  rem: "w-[11%] px-0.5 lg:w-[4.25rem] lg:px-2",
  total: "w-[20%] px-0.5 pr-1 lg:w-[6.25rem] lg:px-2 lg:pr-3",
  // Own column on desktop only; on mobile the delete icon lives inside the
  // Produit cell so it never steals width from TOTAL (see below).
  action: "max-lg:hidden lg:w-10 lg:px-2",
} as const;

// Mobile headers must fit their (narrow) column - shrink font + drop the
// wide letter-spacing so "PRIX TTC" never spills into "REM.". Desktop keeps
// the default header type.
const H_MOBILE = "max-lg:text-[10px] max-lg:tracking-normal";

export function CartTable({
  lines,
  operationType,
  readOnly = false,
  canEditPrice = false,
  onIncrement,
  onDecrement,
  onQuantityChange,
  onDiscountChange,
  onPriceChange,
  onRemove,
}: CartTableProps) {
  const isTransfer = operationType === "transfer";
  const priceEditable = canEditPrice && !isTransfer && !readOnly && !!onPriceChange;

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center max-lg:gap-1 max-lg:py-4">
        <ShoppingCart
          aria-hidden="true"
          className="h-8 w-8 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">Le panier est vide.</p>
        <p className="text-xs text-muted-foreground/70">
          Cliquez sur un produit pour l&apos;ajouter.
        </p>
      </div>
    );
  }

  // The VAT column is intentionally NOT rendered (line.tvaAmount is still
  // computed upstream, still persisted, still used by accounting / ticket -
  // only its display here is removed).
  return (
    // Mobile: w-full + min-w-0 -> the table is exactly the panel width and
    // the % columns fill it (no internal scroll). Desktop keeps its floor so
    // `table-fixed` never collapses the flexible Produit column.
    <Table className="table-fixed min-w-0 lg:min-w-[34rem]">
      <TableHeader>
        <TableRow>
          <TableHead className={cn(COL.produit, H_MOBILE)}>Produit</TableHead>
          <TableHead className={cn(COL.qte, "text-center", H_MOBILE)}>
            Qte
          </TableHead>
          <TableHead className={cn(COL.prix, "text-center", H_MOBILE)}>
            {isTransfer ? "Valeur unit." : "Prix TTC"}
          </TableHead>
          {!isTransfer && (
            <TableHead className={cn(COL.rem, "text-center", H_MOBILE)}>
              {/* Compact "Rem." on mobile (column too narrow for more);
                  "Rem. DH" on desktop so the unit is explicit - this field
                  is a DH amount per unit, never a percentage. */}
              <span className="lg:hidden">Rem.</span>
              <span className="hidden lg:inline">Rem. DH</span>
            </TableHead>
          )}
          <TableHead className={cn(COL.total, "text-right", H_MOBILE)}>
            {isTransfer ? "Valeur" : "Total"}
          </TableHead>
          <TableHead className={COL.action} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          // Mobile: cells align to the top so QTE / PRIX / REM. / TOTAL stay
          // readable when the product name wraps to 2-3 lines. Desktop keeps
          // its previously-validated vertical-align (middle).
          <TableRow key={line.productId} className="max-lg:[&>td]:align-top">
            <TableCell className={cn(COL.produit, "relative pr-1")}>
              {/* Mobile-only compact delete - pulled out of the text flow
                  (absolute, top-right) so the name can use the full column
                  width on every line; `pr-5` keeps the first line clear of it.
                  Desktop uses its own dedicated column instead. */}
              <button
                type="button"
                aria-label={`Retirer ${line.designation} du panier`}
                disabled={readOnly}
                onClick={() => onRemove(line.productId)}
                className="absolute right-0 top-2 rounded-md p-0.5 text-muted-foreground hover:text-red-600 disabled:opacity-40 lg:hidden"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-0">
                {/* Full product name - never clipped with an ellipsis.
                    `whitespace-normal` overrides the `whitespace-nowrap`
                    TableCell sets by default; wrapping happens on spaces and
                    `break-words` only splits a single word when it is itself
                    too wide for the column, so it can never overflow. */}
                <p className="pr-5 font-medium whitespace-normal break-words text-foreground lg:pr-0">
                  {line.designation}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {line.reference}
                </p>
              </div>
            </TableCell>
            <TableCell className={COL.qte}>
              <div className="flex items-center justify-center gap-0 lg:gap-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className="size-6 lg:size-8"
                  aria-label="Diminuer la quantite"
                  disabled={readOnly}
                  onClick={() => onDecrement(line.productId)}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  disabled={readOnly}
                  onFocus={selectAllOnFocus}
                  onChange={(event) =>
                    onQuantityChange(
                      line.productId,
                      Math.max(1, Number(event.target.value)),
                    )
                  }
                  aria-label="Quantite"
                  className="h-7 w-7 rounded-md border border-input bg-transparent text-center text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 lg:w-11"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className="size-6 lg:size-8"
                  aria-label="Augmenter la quantite"
                  disabled={readOnly}
                  onClick={() => onIncrement(line.productId)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </TableCell>
            <TableCell className={cn(COL.prix, "text-center tabular-nums")}>
              {priceEditable ? (
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={Number(line.unitPriceTTC.toFixed(2))}
                  onFocus={selectAllOnFocus}
                  onChange={(event) =>
                    onPriceChange!(
                      line.productId,
                      event.target.value === "" ? null : Number(event.target.value),
                    )
                  }
                  aria-label={`Prix TTC de ${line.designation}`}
                  className={cn(
                    "h-7 w-9 rounded-md border bg-transparent text-center text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 lg:w-20",
                    line.priceOverridden
                      ? "border-amber-400 font-medium text-amber-700"
                      : "border-input",
                  )}
                />
              ) : (
                <span className="max-lg:text-xs">
                  {formatCurrency(isTransfer ? line.unitPriceHT : line.unitPriceTTC)}
                </span>
              )}
            </TableCell>
            {!isTransfer && (
              <TableCell className={cn(COL.rem, "text-center")}>
                <input
                  type="number"
                  min={0}
                  max={line.unitPriceTTC}
                  step="0.01"
                  value={line.discountUnitAmount}
                  disabled={readOnly}
                  onFocus={selectAllOnFocus}
                  onChange={(event) =>
                    onDiscountChange(line.productId, Math.max(0, Number(event.target.value)))
                  }
                  aria-label={`Remise en DH par unité de ${line.designation}`}
                  className="h-7 w-7 rounded-md border border-input bg-transparent text-center text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 lg:w-14"
                />
              </TableCell>
            )}
            <TableCell
              className={cn(
                COL.total,
                "text-right font-medium tabular-nums max-lg:overflow-hidden max-lg:text-xs",
              )}
            >
              {formatCurrency(isTransfer ? line.transferValue : line.totalTTC)}
            </TableCell>
            <TableCell className={COL.action}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Retirer ${line.designation} du panier`}
                disabled={readOnly}
                onClick={() => onRemove(line.productId)}
                className="text-muted-foreground hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
