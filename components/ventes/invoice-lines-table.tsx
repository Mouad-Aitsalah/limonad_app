import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import { unitPriceTTCFromHT } from "@/lib/pos-discount";
import type { SaleLineDto } from "@/types/operations-dto";

/**
 * The products of an invoice, as shown by the order detail of "Factures
 * journalières" / "Archives des factures" (inline row and dialog), so both always
 * show the same thing: Produit | Quantité | Prix - no discount, no line total.
 *
 * Prix = the normal (catalogue) unit price TTC, BEFORE any discount, computed with
 * the SAME function as the invoice PDF (unitPriceTTCFromHT, lib/pos-discount.ts):
 * HT x (1 + the line's own taxRate), to the cent. A discount is not shown here but
 * stays in the persisted line totals, hence in the invoice's Total HT / TVA /
 * Total TTC below the table. Display only: nothing is recomputed or stored.
 *
 * Compact on purpose: the product takes the free width, the numeric columns only
 * their content (w-px + nowrap), small paddings; the product name wraps instead of
 * forcing a horizontal scroll on a phone.
 */

const headClass = "h-9 px-2 text-[0.68rem] tracking-[0.12em] sm:px-3";
const numericHeadClass = cn(headClass, "w-px text-right");
const cellClass = "px-2 py-2 text-sm sm:px-3";
const numericCellClass = cn(cellClass, "w-px text-right tabular-nums");

export function InvoiceLinesTable({ lines }: { lines: SaleLineDto[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className={cn(headClass, "w-full")}>Produit</TableHead>
          <TableHead className={numericHeadClass}>
            <span className="sm:hidden">Qté</span>
            <span className="max-sm:hidden">Quantité</span>
          </TableHead>
          <TableHead className={numericHeadClass} title="Prix unitaire TTC">
            Prix
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.id}>
            <TableCell
              className={cn(cellClass, "min-w-[6rem] font-medium whitespace-normal break-words text-foreground")}
            >
              {line.productName}
            </TableCell>
            <TableCell className={numericCellClass}>{line.quantity}</TableCell>
            <TableCell className={numericCellClass}>
              {formatCurrency(unitPriceTTCFromHT(line.unitPriceHT, line.taxRate))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
