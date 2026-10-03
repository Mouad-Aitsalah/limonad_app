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
import { isSellingBelowCost } from "@/lib/pos-margin";
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
  /**
   * Counter-POS PC layout (>= lg only; < lg is identical either way): the
   * delete icon sits to the right of the product name instead of in its own
   * last column, the Qte / Prix TTC / Rem. DH controls and the Prix TTC /
   * Total texts share one height and size, product names are x0.9 and rows
   * are shorter (cell padding py-4 -> py-2 = x0.8 of a one-line row). Opt-in so the driver POS, which
   * reuses this table, keeps its current look.
   */
  pcLayout?: boolean;
  /**
   * Driver POS on a phone (< lg) only - opt-in, so the counter POS and every
   * other caller keep their current look: product names x1.15 (15.04px ->
   * 17.296px), the four column titles in bold (700 instead of 600), the
   * quantity x1.1 (16px -> 17.6px) and the unit price TTC at the same 17.6px
   * (was 12px), the Qte / Prix / Rem. / Total cells centred on the vertical
   * middle of the row and the Total TTC column shown on phones (fixed narrow
   * columns, Produit takes the remaining width). The reference line under the name, the +/- and delete
   * buttons, the discount field and every size at >= lg are untouched.
   */
  driverMobileStyle?: boolean;
};

// Column widths are the single source of truth (`table-fixed` makes every
// <td> take its <th> width exactly). Two regimes:
//  - MOBILE (< lg): percentages that sum to 100% -> the whole table fits the
//    cart panel, no internal horizontal scroll. TOTAL is dropped entirely on
//    mobile (see COL.total) - its 20% is redistributed to the other 4
//    columns, weighted toward Produit (still summing to 100%: 40+26+19+15).
//    The per-line amount is never removed from the DATA, only this display -
//    "Total à payer" (CartSummary) still reflects it in full.
//  - DESKTOP (lg+): the previously-validated fixed rem widths, untouched.
const COL = {
  produit: "w-[40%] px-1 lg:w-auto lg:px-4",
  qte: "w-[26%] px-0.5 lg:w-[11.5rem] lg:px-2",
  prix: "w-[19%] px-0.5 lg:w-36 lg:px-2",
  rem: "w-[15%] px-0.5 lg:w-[7.5rem] lg:px-2",
  // Desktop-only now - see this constant group's own comment above.
  total: "max-lg:hidden lg:w-[6.25rem] lg:px-2 lg:pr-3",
  // Own column on desktop only; on mobile the delete icon lives inside the
  // Produit cell so it never steals width from the row (see below).
  action: "max-lg:hidden lg:w-10 lg:px-2",
} as const;

// Mobile headers must fit their (narrow) column - shrink font + drop the
// wide letter-spacing so "PRIX TTC" never spills into "REM.". Desktop keeps
// the default header type.
const H_MOBILE = "max-lg:text-[10px] max-lg:tracking-normal";
// Desktop only: header type x1.4 (0.72rem = 11.52px -> 16.128px), bold.
const H_DESKTOP = "lg:text-[16.128px] lg:font-bold";
// Opt-in (driverMobileStyle): column titles in bold on phones; same size,
// colour, alignment and background as before.
const H_MOBILE_BOLD = "max-lg:font-bold";
// Opt-in (driverMobileStyle): the Total TTC column is shown on phones and the
// four narrow columns get FIXED widths sized to their content, so Produit
// (width auto) takes all the remaining room and grows with the screen:
//  - Qte  80px = 24px "-" + 32px field (3 digits at 17.6px) + 24px "+", no padding
//  - Prix 66px = "1.250,50" at 17.6px, "DH" drops under the amount
//  - Rem. 32px = the 28px field
//  - Total 58px = "150.060,00" at 12px, "DH" drops under the amount
// Only the phone widths change - twMerge keeps the `lg:` ones.
const COL_DRIVER_MOBILE = {
  produit: "max-lg:w-auto",
  qte: "max-lg:w-20 max-lg:px-0",
  prix: "max-lg:w-[66px]",
  rem: "max-lg:w-8",
  // `table-cell` replaces COL.total's `max-lg:hidden` (same display group).
  total: "max-lg:table-cell max-lg:w-[58px] max-lg:px-0.5 max-lg:text-center max-lg:whitespace-normal max-lg:leading-tight max-lg:[overflow-wrap:anywhere]",
} as const;
// Opt-in (driverMobileStyle): Qte / Prix / Rem. cells sit on the vertical
// middle of the row (the default mobile alignment is top).
// `!` because the row's own `[&>td]:align-top` rule is more specific.
const CELL_DRIVER_MIDDLE = "max-lg:align-middle!";

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
  pcLayout = false,
  driverMobileStyle = false,
}: CartTableProps) {
  const isTransfer = operationType === "transfer";
  const priceEditable = canEditPrice && !isTransfer && !readOnly && !!onPriceChange;
  // PC counter POS only; the data is absent (-> false) for cashiers, drivers,
  // frozen / pending lines and transfers.
  const belowCost = (line: CartLineComputed) =>
    pcLayout && !isTransfer && isSellingBelowCost(line.unitPriceTTC, line.purchasePriceTTC);

  // Same amount and format everywhere. Driver phone only: the no-break space
  // before "DH" becomes a regular one so the unit can drop under a 4-digit
  // amount that is wider than the Prix column (nowrap on >= lg keeps one line).
  const money = (value: number) => {
    const label = formatCurrency(value);
    return driverMobileStyle ? label.replace(/ /g, " ") : label;
  };

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
    <Table className="table-fixed min-w-0 lg:min-w-[48rem]">
      <TableHeader>
        <TableRow>
          <TableHead className={cn(COL.produit, H_MOBILE, H_DESKTOP, driverMobileStyle && [H_MOBILE_BOLD, COL_DRIVER_MOBILE.produit])}>Produit</TableHead>
          <TableHead className={cn(COL.qte, "text-center", H_MOBILE, H_DESKTOP, driverMobileStyle && [H_MOBILE_BOLD, COL_DRIVER_MOBILE.qte])}>
            Qte
          </TableHead>
          <TableHead className={cn(COL.prix, "text-center", H_MOBILE, H_DESKTOP, driverMobileStyle && [H_MOBILE_BOLD, COL_DRIVER_MOBILE.prix])}>
            {isTransfer ? "Valeur unit." : "Prix TTC"}
          </TableHead>
          {!isTransfer && (
            <TableHead className={cn(COL.rem, "text-center", H_MOBILE, H_DESKTOP, driverMobileStyle && [H_MOBILE_BOLD, COL_DRIVER_MOBILE.rem])}>
              {/* Compact "Rem." on mobile (column too narrow for more);
                  "Rem. DH" on desktop so the unit is explicit - this field
                  is a DH amount per unit, never a percentage. */}
              <span className="lg:hidden">Rem.</span>
              <span className="hidden lg:inline">Rem. DH</span>
            </TableHead>
          )}
          <TableHead
            className={cn(
              COL.total,
              "text-right",
              H_MOBILE,
              H_DESKTOP,
              driverMobileStyle && [H_MOBILE_BOLD, COL_DRIVER_MOBILE.total],
            )}
          >
            {isTransfer ? (
              "Valeur"
            ) : driverMobileStyle ? (
              <>
                <span className="lg:hidden">Total TTC</span>
                <span className="hidden lg:inline">Total</span>
              </>
            ) : (
              "Total"
            )}
          </TableHead>
          {!pcLayout && <TableHead className={COL.action} />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          // Mobile: cells align to the top so QTE / PRIX / REM. / TOTAL stay
          // readable when the product name wraps to 2-3 lines. Desktop keeps
          // its previously-validated vertical-align (middle).
          <TableRow key={line.productId} data-product-id={line.productId} className={cn("max-lg:[&>td]:align-top", pcLayout && "lg:[&>td]:py-2")}>
            <TableCell className={cn(COL.produit, "relative pr-1", driverMobileStyle && COL_DRIVER_MOBILE.produit)}>
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
              <div className={cn("min-w-0", pcLayout && "lg:flex lg:items-start lg:justify-between lg:gap-3")}>
                <div className="min-w-0">
                {/* Full product name - never clipped with an ellipsis.
                    `whitespace-normal` overrides the `whitespace-nowrap`
                    TableCell sets by default; wrapping happens on spaces and
                    `break-words` only splits a single word when it is itself
                    too wide for the column, so it can never overflow. */}
                <p
                  className={cn(
                    "pr-5 font-medium whitespace-normal break-words text-foreground lg:pr-0 lg:text-[22.56px] lg:font-bold",
                    // PC counter POS: name type x0.9 (22.56px -> 20.304px).
                    pcLayout && "lg:text-[20.304px]",
                    // Driver POS phone: x1.15 of the inherited 15.04px.
                    driverMobileStyle && "max-lg:text-[17.296px]",
                  )}
                >
                  {line.designation}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {line.reference}
                </p>
                </div>
                {pcLayout && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Retirer ${line.designation} du panier`}
                    disabled={readOnly}
                    onClick={() => onRemove(line.productId)}
                    className="hidden shrink-0 text-muted-foreground hover:text-red-600 lg:inline-flex"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </TableCell>
            <TableCell className={cn(COL.qte, driverMobileStyle && [COL_DRIVER_MOBILE.qte, CELL_DRIVER_MIDDLE])}>
              <div className="flex items-center justify-center gap-0 lg:gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className="size-6 lg:size-12"
                  aria-label="Diminuer la quantite"
                  disabled={readOnly}
                  onClick={() => onDecrement(line.productId)}
                >
                  <Minus className="h-3 w-3 lg:h-[18px] lg:w-[18px]" />
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
                  className={cn(
                    "h-7 w-7 rounded-md border border-input bg-transparent text-center text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 lg:h-[2.625rem] lg:w-[4.125rem] lg:text-[21px]",
                    // Driver POS phone: quantity x1.1 (16px -> 17.6px; `!` because the
                    // global phone rule forces 1rem on every input) and the box 4px
                    // wider so a 3-digit quantity still fits. The +/- buttons keep size.
                    driverMobileStyle && "max-lg:w-8 max-lg:text-[17.6px]!",
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className="size-6 lg:size-12"
                  aria-label="Augmenter la quantite"
                  disabled={readOnly}
                  onClick={() => onIncrement(line.productId)}
                >
                  <Plus className="h-3 w-3 lg:h-[18px] lg:w-[18px]" />
                </Button>
              </div>
            </TableCell>
            <TableCell
              className={cn(
                COL.prix,
                "text-center tabular-nums",
                driverMobileStyle && [COL_DRIVER_MOBILE.prix, CELL_DRIVER_MIDDLE],
              )}
            >
              {priceEditable ? (
                <input
                  data-below-cost={belowCost(line) ? "true" : undefined}
                  title={belowCost(line) ? "Prix inférieur au prix d'achat" : undefined}
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
                    pcLayout && "lg:h-[2.625rem] lg:w-[6.5rem] lg:text-[21px]",
                    // Below-cost warning (PC counter POS only, display only).
                    // The focus variants are repeated because the base focus
                    // style (emerald) would otherwise win while typing.
                    belowCost(line) &&
                      "lg:border-red-400 lg:bg-red-50 lg:text-red-700 lg:focus-visible:border-red-500 lg:focus-visible:ring-red-500/20",
                    line.priceOverridden
                      ? "border-amber-400 font-medium text-amber-700"
                      : "border-input",
                  )}
                />
              ) : (
                <span
                  className={cn(
                    "max-lg:text-xs",
                    // Driver POS phone: same size as the quantity (12px -> 17.6px),
                    // value/format/weight untouched. The unit stays on the amount's
                    // line, and only drops below it (centred) when a 4-digit amount
                    // is wider than the column.
                    driverMobileStyle && "max-lg:block max-lg:text-[17.6px] max-lg:leading-tight max-lg:whitespace-normal max-lg:[overflow-wrap:anywhere]",
                    pcLayout && "lg:text-[21px] lg:font-medium",
                  )}
                >
                  {money(isTransfer ? line.unitPriceHT : line.unitPriceTTC)}
                </span>
              )}
            </TableCell>
            {!isTransfer && (
              <TableCell
                className={cn(
                  COL.rem,
                  "text-center",
                  driverMobileStyle && [COL_DRIVER_MOBILE.rem, CELL_DRIVER_MIDDLE],
                )}
              >
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
                  className="h-7 w-7 rounded-md border border-input bg-transparent text-center text-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 lg:h-[2.625rem] lg:w-[5.25rem] lg:text-[21px]"
                />
              </TableCell>
            )}
            <TableCell
              className={cn(
                COL.total,
                "text-right font-medium tabular-nums max-lg:overflow-hidden max-lg:text-xs",
                pcLayout && "lg:text-[21px]",
                driverMobileStyle && [COL_DRIVER_MOBILE.total, CELL_DRIVER_MIDDLE],
              )}
            >
              {money(isTransfer ? line.transferValue : line.totalTTC)}
            </TableCell>
            {!pcLayout && (
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
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
