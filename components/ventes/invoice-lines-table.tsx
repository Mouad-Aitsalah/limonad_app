import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { unitPriceTTCFromHT } from "@/lib/pos-discount";
import { cn, formatCurrency } from "@/lib/utils";
import type { SaleLineDto } from "@/types/operations-dto";

/**
 * The products of an invoice, as shown by the order detail of "Factures
 * journalières" / "Archives des factures" (inline row and dialog), so both always
 * show the same thing: Produit | Prix TTC | Qté | Total TTC - no discount column.
 *
 * Prix TTC   = the normal (catalogue) unit price TTC, BEFORE any discount, computed
 *              with the SAME function as the invoice PDF (unitPriceTTCFromHT,
 *              lib/pos-discount.ts): HT x (1 + the line's own taxRate), to the cent.
 * Total TTC  = line.totalTTC, the amount actually invoiced and stored for the line
 *              (discount included, historical roundings included). It is read, never
 *              recomputed from Prix x Qté: on a discounted line the two differ by
 *              exactly the discount (20,00 DH x 3 -> 57,00 DH with 1,00 DH off per
 *              unit), and the lines still add up to the invoice's Total TTC below.
 *
 * Display only: nothing is recomputed into the sale or stored.
 *
 * Compact on purpose: the product takes the free width, the three numeric columns
 * only their content (w-px + nowrap), small paddings and a smaller font on a phone
 * so all four columns stay visible without any horizontal scroll; the product name
 * wraps instead.
 */

const headClass = "h-9 px-1.5 text-[0.62rem] tracking-[0.08em] sm:px-3 sm:text-[0.68rem] sm:tracking-[0.12em]";
const numericHeadClass = cn(headClass, "w-px px-1 text-right sm:px-3");
const cellClass = "px-1.5 py-2 text-xs sm:px-3 sm:text-sm";
const numericCellClass = cn(cellClass, "w-px px-1 text-right tabular-nums sm:px-3");

export function InvoiceLinesTable({ lines }: { lines: SaleLineDto[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className={cn(headClass, "w-full")}>Produit</TableHead>
          <TableHead className={numericHeadClass} title="Prix unitaire TTC catalogue">
            Prix TTC
          </TableHead>
          <TableHead className={numericHeadClass} title="Quantité">
            Qté
          </TableHead>
          <TableHead className={numericHeadClass} title="Montant TTC facturé de la ligne">
            Total TTC
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.id}>
            <TableCell
              className={cn(cellClass, "min-w-[4.5rem] font-medium whitespace-normal break-words text-foreground")}
            >
              {line.productName}
            </TableCell>
            <TableCell className={numericCellClass}>
              {formatCurrency(unitPriceTTCFromHT(line.unitPriceHT, line.taxRate))}
            </TableCell>
            <TableCell className={numericCellClass}>{line.quantity}</TableCell>
            <TableCell className={cn(numericCellClass, "font-medium")}>
              {formatCurrency(line.totalTTC)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
