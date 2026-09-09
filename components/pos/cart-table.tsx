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
  onDiscountChange: (productId: string, discountPercent: number) => void;
  onPriceChange?: (productId: string, unitPriceTTC: number | null) => void;
  onRemove: (productId: string) => void;
};

// Column widths are the SINGLE source of truth for the layout: `table-fixed`
// on the <table> makes every <td> take its column's <th> width exactly, so a
// header can never end up wider/narrower than the field under it. Produit is
// the only flexible column (takes the remaining space on desktop, a fixed
// readable width on mobile). Values are set here once and reused by header +
// body so th and td always agree.
const COL = {
  // Mobile widths ~match the previously validated compact table; desktop
  // widths give each numeric column room so its header centers over the
  // field. Produit is fixed on mobile (name truncates) and flexible on
  // desktop (takes the remaining space).
  produit: "w-[8rem] lg:w-auto",
  qte: "w-[6.5rem] px-0.5 lg:w-[7.5rem] lg:px-2",
  prix: "w-[4.5rem] px-0.5 lg:w-24 lg:px-2",
  rem: "w-[3.25rem] px-0.5 lg:w-[4.25rem] lg:px-2",
  total: "w-[4.75rem] px-0.5 pr-2 lg:w-[6.25rem] lg:px-2 lg:pr-3",
  action: "w-8 px-0.5 lg:w-10 lg:px-2",
} as const;

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
  // only its display here is removed). The table stays inside the cart's
  // own `overflow-x-auto` wrapper: when it is wider than the panel the
  // scroll is internal, the page never scrolls sideways.
  return (
    // `min-w` keeps the columns at their intended sizes: `table-fixed`
    // ignores a per-cell min-width, so the floor lives on the table. When
    // the cart panel is narrower than this, the scroll is internal to the
    // wrapper (overflow-x-auto) and the page never scrolls sideways.
    <Table className="table-fixed min-w-[29rem] lg:min-w-[34rem]">
      <TableHeader>
        <TableRow>
          <TableHead className={COL.produit}>Produit</TableHead>
          <TableHead className={cn(COL.qte, "text-right lg:text-center")}>
            Qte
          </TableHead>
          <TableHead className={cn(COL.prix, "text-right lg:text-center")}>
            {isTransfer ? "Valeur unit." : "Prix TTC"}
          </TableHead>
          {!isTransfer && (
            <TableHead className={cn(COL.rem, "text-right lg:text-center")}>
              Rem.
            </TableHead>
          )}
          <TableHead className={cn(COL.total, "text-right")}>
            {isTransfer ? "Valeur" : "Total"}
          </TableHead>
          <TableHead className={COL.action} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.productId}>
            <TableCell className={cn(COL.produit, "pr-1")}>
              <p className="truncate font-medium text-foreground">
                {line.designation}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {line.reference}
              </p>
            </TableCell>
            <TableCell className={COL.qte}>
              <div className="flex items-center justify-end gap-0.5 lg:justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
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
                  className="h-7 w-9 rounded-md border border-input bg-transparent text-center text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 sm:w-11"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Augmenter la quantite"
                  disabled={readOnly}
                  onClick={() => onIncrement(line.productId)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </TableCell>
            <TableCell
              className={cn(COL.prix, "text-right tabular-nums lg:text-center")}
            >
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
                    "h-7 w-16 rounded-md border bg-transparent text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 sm:w-20 lg:text-center",
                    line.priceOverridden
                      ? "border-amber-400 font-medium text-amber-700"
                      : "border-input",
                  )}
                />
              ) : (
                formatCurrency(isTransfer ? line.unitPriceHT : line.unitPriceTTC)
              )}
            </TableCell>
            {!isTransfer && (
              <TableCell
                className={cn(COL.rem, "text-right lg:text-center")}
              >
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={line.discountPercent}
                  disabled={readOnly}
                  onFocus={selectAllOnFocus}
                  onChange={(event) =>
                    onDiscountChange(
                      line.productId,
                      Math.min(100, Math.max(0, Number(event.target.value))),
                    )
                  }
                  aria-label="Remise en pourcentage"
                  className="h-7 w-11 rounded-md border border-input bg-transparent text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 sm:w-14 lg:text-center"
                />
              </TableCell>
            )}
            <TableCell
              className={cn(
                COL.total,
                "text-right font-medium tabular-nums",
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
