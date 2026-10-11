import { roundMoney } from "@/lib/money";
import { reconstructDiscountUnitAmount } from "@/lib/pos-discount";

/**
 * "REMISE" indicator of the invoice lists (Archives des factures and Factures
 * journalières).
 *
 * WHICH invoices: those where a discount was really APPLIED to an article. The
 * evidence is the STORED line discount (`SaleLine.discountAmount`, HT, the very
 * column the POS/server write when a cashier or driver types a discount; the
 * sale-level `Sale.discountAmount` is only the sum of those, so it adds nothing)
 * confirmed by what the line was actually sold for: the DH taken off the line's
 * OWN unit price TTC - read with the helper the POS uses to show a discount
 * again (reconstructDiscountUnitAmount) - must be at least one cent.
 *
 * Why the confirmation: a stored HT discount of 0.01 also appears on invoices
 * where NOTHING was discounted (HT 4.17 x 2 = 8.34 against 10.00 TTC / 1.2 =
 * 8.33: a pure rounding difference). Those must not be flagged. Conversely the
 * indicator is never inferred from a total lower than the catalogue price: the
 * catalogue is not consulted at all, only the line's own stored price, quantity
 * and total, and only for lines that carry a stored discount. A price edit, an
 * old tariff or a historical rounding never makes an invoice "discounted".
 * There is no separate global discount.
 *
 * HOW MUCH: that same DH amount (per unit x quantity, all discounted lines), i.e.
 * what the cashier typed and the customer saw - an old percentage discount is
 * read as the DH it amounted to.
 *
 * WHO: the server only adds the indicator to the rows it sends to the roles in
 * DISCOUNT_INDICATOR_ROLES (the lists are staff-only anyway; a driver gets a
 * 403 on them) - the UI never decides alone.
 */
export const DISCOUNT_INDICATOR_ROLES = ["super_admin", "admin", "cashier"] as const;

export function canSeeDiscountIndicator(role: string | null | undefined): boolean {
  return Boolean(role) && (DISCOUNT_INDICATOR_ROLES as readonly string[]).includes(role as string);
}

export type InvoiceDiscountLine = {
  /** SaleLine.discountAmount (HT) - the stored discount. */
  discountAmount: number;
  taxRate: number;
  quantity: number;
  /** The unit price HT this line was actually sold at. */
  unitPriceHT: number;
  totalTTC: number;
};

export type InvoiceDiscountInput = { lines: InvoiceDiscountLine[] };

export type InvoiceDiscount = { hasDiscount: boolean; amountTTC: number };

export function computeInvoiceDiscount(input: InvoiceDiscountInput): InvoiceDiscount {
  const amountTTC = roundMoney(
    input.lines
      .filter((line) => line.discountAmount > 0)
      .reduce(
        (sum, line) =>
          sum +
          roundMoney(
            line.quantity *
              reconstructDiscountUnitAmount({
                unitPriceHT: line.unitPriceHT,
                taxRate: line.taxRate,
                quantity: line.quantity,
                totalTTC: line.totalTTC,
              }),
          ),
        0,
      ),
  );
  return amountTTC >= 0.01 ? { hasDiscount: true, amountTTC } : { hasDiscount: false, amountTTC: 0 };
}
