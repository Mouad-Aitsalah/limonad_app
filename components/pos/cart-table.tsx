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

  // Numeric columns are packed tight together on the right (px-0.5, and the
  // Qte stepper is right-aligned) while the Produit column (w-full) absorbs
  // the slack - so Qte and Prix TTC sit right next to each other. The VAT
  // column is intentionally NOT rendered
  // (line.tvaAmount is still computed upstream, still persisted, still used
  // by accounting / ticket - only its display here is removed).
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-full min-w-[6rem]">Produit</TableHead>
          <TableHead className="px-0.5 text-right">Qte</TableHead>
          <TableHead className="px-0.5 text-right">
            {isTransfer ? "Valeur unit." : "Prix TTC"}
          </TableHead>
          {!isTransfer && (
            <TableHead className="px-0.5 text-right">Rem. %</TableHead>
          )}
          <TableHead className="px-0.5 pr-2 text-right">
            {isTransfer ? "Valeur" : "Total"}
          </TableHead>
          <TableHead className="w-8 px-0.5" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.productId}>
            <TableCell className="max-w-[150px] pr-1 sm:max-w-[240px]">
              <p className="truncate font-medium text-foreground">
                {line.designation}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {line.reference}
              </p>
            </TableCell>
            <TableCell className="px-0.5">
              <div className="flex items-center justify-end gap-0.5">
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
            <TableCell className="px-0.5 text-right tabular-nums">
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
                    "h-7 w-16 rounded-md border bg-transparent text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 sm:w-20",
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
              <TableCell className="px-0.5 text-right">
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
                  className="h-7 w-11 rounded-md border border-input bg-transparent text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 sm:w-14"
                />
              </TableCell>
            )}
            <TableCell className="px-0.5 pr-2 text-right font-medium tabular-nums">
              {formatCurrency(isTransfer ? line.transferValue : line.totalTTC)}
            </TableCell>
            <TableCell className="px-0.5">
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
