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
import { formatCurrency } from "@/lib/utils";
import type { CartLineComputed } from "@/components/pos/pos-layout";
import type { PosOperationType } from "@/types/pos";

type CartTableProps = {
  lines: CartLineComputed[];
  operationType: PosOperationType;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onDiscountChange: (productId: string, discountPercent: number) => void;
  onRemove: (productId: string) => void;
};

export function CartTable({
  lines,
  operationType,
  onIncrement,
  onDecrement,
  onQuantityChange,
  onDiscountChange,
  onRemove,
}: CartTableProps) {
  const isTransfer = operationType === "transfer";

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
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

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Produit</TableHead>
          <TableHead className="text-center">Qte</TableHead>
          <TableHead className="text-right">
            {isTransfer ? "Valeur unit." : "Prix TTC"}
          </TableHead>
          {!isTransfer && <TableHead className="text-right">Remise %</TableHead>}
          {!isTransfer && <TableHead className="text-right">TVA</TableHead>}
          <TableHead className="text-right">
            {isTransfer ? "Valeur" : "Total"}
          </TableHead>
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.productId}>
            <TableCell className="max-w-[140px]">
              <p className="truncate font-medium text-foreground">
                {line.designation}
              </p>
              <p className="text-xs text-muted-foreground">{line.reference}</p>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Diminuer la quantite"
                  onClick={() => onDecrement(line.productId)}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(event) =>
                    onQuantityChange(
                      line.productId,
                      Math.max(1, Number(event.target.value)),
                    )
                  }
                  aria-label="Quantite"
                  className="h-7 w-11 rounded-md border border-input bg-transparent text-center text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="Augmenter la quantite"
                  onClick={() => onIncrement(line.productId)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCurrency(isTransfer ? line.unitPriceHT : line.unitPriceTTC)}
            </TableCell>
            {!isTransfer && (
              <TableCell className="text-right">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={line.discountPercent}
                  onChange={(event) =>
                    onDiscountChange(
                      line.productId,
                      Math.min(100, Math.max(0, Number(event.target.value))),
                    )
                  }
                  aria-label="Remise en pourcentage"
                  className="h-7 w-14 rounded-md border border-input bg-transparent text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
                />
              </TableCell>
            )}
            {!isTransfer && (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCurrency(line.tvaAmount)}
              </TableCell>
            )}
            <TableCell className="text-right font-medium tabular-nums">
              {formatCurrency(isTransfer ? line.transferValue : line.totalTTC)}
            </TableCell>
            <TableCell>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Retirer ${line.designation} du panier`}
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
