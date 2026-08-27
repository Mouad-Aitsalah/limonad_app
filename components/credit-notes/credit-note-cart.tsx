import { Minus, Plus, Trash2 } from "lucide-react";

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

type CreditNoteCartLine = {
  productId: string;
  productName: string;
  productReference: string;
  quantityReturned: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  taxAmount: number;
  totalTTC: number;
};

type CreditNoteCartProps = {
  lines: CreditNoteCartLine[];
  disabled?: boolean;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onUnitPriceChange: (productId: string, unitPrice: number) => void;
  onDiscountChange: (productId: string, discountPercent: number) => void;
  onRemove: (productId: string) => void;
};

export function CreditNoteCart({
  lines,
  disabled = false,
  onIncrement,
  onDecrement,
  onQuantityChange,
  onUnitPriceChange,
  onDiscountChange,
  onRemove,
}: CreditNoteCartProps) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
        <p className="text-sm text-muted-foreground">Le panier d&apos;avoir est vide.</p>
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
          <TableHead className="text-right">Prix reprise</TableHead>
          <TableHead className="text-right">Remise %</TableHead>
          <TableHead className="text-right">TVA</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.productId}>
            <TableCell className="max-w-[160px]">
              <p className="truncate font-medium text-foreground">{line.productName}</p>
              <p className="text-xs text-muted-foreground">{line.productReference}</p>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  disabled={disabled}
                  onClick={() => onDecrement(line.productId)}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <input
                  type="number"
                  min={1}
                  value={line.quantityReturned}
                  disabled={disabled}
                  onChange={(event) =>
                    onQuantityChange(
                      line.productId,
                      Math.max(1, Number(event.target.value) || 1),
                    )
                  }
                  className="h-7 w-12 rounded-md border border-input bg-transparent text-center text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  disabled={disabled}
                  onClick={() => onIncrement(line.productId)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </TableCell>
            <TableCell className="text-right">
              <input
                type="number"
                min={0}
                step="0.01"
                value={line.unitPrice}
                disabled={disabled}
                onChange={(event) =>
                  onUnitPriceChange(line.productId, Math.max(0, Number(event.target.value) || 0))
                }
                className="h-7 w-20 rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
              />
            </TableCell>
            <TableCell className="text-right">
              <input
                type="number"
                min={0}
                max={100}
                value={line.discountPercent}
                disabled={disabled}
                onChange={(event) =>
                  onDiscountChange(
                    line.productId,
                    Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                  )
                }
                className="h-7 w-16 rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
              />
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatCurrency(line.taxAmount)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatCurrency(line.totalTTC)}
            </TableCell>
            <TableCell>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
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
