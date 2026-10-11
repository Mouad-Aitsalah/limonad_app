import { roundMoney } from "@/lib/money";
import { computeInvoiceDiscount } from "@/lib/sale-discount-indicator";
import { formatSaleDisplayNumber } from "@/lib/sale-display-number";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { SaleHistoryListItemDto } from "@/types/operations-dto";

/**
 * The row of the invoice lists (Archives des factures and Factures
 * journalières): what is selected from a Sale and how it becomes a
 * SaleHistoryListItemDto. Kept apart from sales-history.ts (which is
 * "server-only") so the mapping - including the role-gated "REMISE" indicator -
 * can be unit-tested against a real database.
 */

// Reused by lib/server/daily-invoices.ts (Factures journalières),
// which renders the same InvoicesTable and so needs the exact same row shape
// and DTO mapping - never a parallel copy that could drift.
export const orderListSelect = {
  id: true,
  invoiceNumber: true,
  saleYear: true,
  saleNumber: true,
  posSessionId: true,
  status: true,
  origin: true,
  totalTTC: true,
  paidAmount: true,
  creditAmount: true,
  paymentMethod: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, code: true, name: true } },
  driver: { select: { id: true, user: { select: { fullName: true } } } },
  createdBy: { select: { fullName: true } },
  // discountAmount / taxRate / unitPriceHT / totalTTC: read only to flag and quantify a "REMISE" for the
  // roles allowed to see it (see lib/sale-discount-indicator.ts); never sent as they are.
  lines: { select: { quantity: true, discountAmount: true, taxRate: true, unitPriceHT: true, totalTTC: true } },
} as const;

export function mapOrderRowToListItemDto(
  row: Prisma.SaleGetPayload<{ select: typeof orderListSelect }>,
  net: number,
  options: { includeDiscount?: boolean } = {},
): SaleHistoryListItemDto {
  // The discount indicator is added ONLY when the caller's role may see it
  // (decided by the server, from the session - see canSeeDiscountIndicator).
  const discount = options.includeDiscount
    ? computeInvoiceDiscount({
        lines: row.lines.map((line) => ({
          discountAmount: line.discountAmount.toNumber(),
          taxRate: line.taxRate.toNumber(),
          quantity: line.quantity,
          unitPriceHT: line.unitPriceHT.toNumber(),
          totalTTC: line.totalTTC.toNumber(),
        })),
      })
    : null;
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    displayNumber: formatSaleDisplayNumber(
      row.saleNumber,
      row.saleYear,
      row.invoiceNumber,
    ),
    posSessionId: row.posSessionId,
    status: row.status,
    origin: row.origin,
    customer: row.customer,
    driver: row.driver ? { id: row.driver.id, name: row.driver.user.fullName } : null,
    articleCount: row.lines.reduce((sum, line) => sum + line.quantity, 0),
    totalTTC: row.totalTTC.toNumber(),
    net: roundMoney(net),
    paidAmount: row.paidAmount.toNumber(),
    creditAmount: row.creditAmount.toNumber(),
    paymentMethod: row.paymentMethod,
    createdByUserName: row.createdBy.fullName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(discount?.hasDiscount ? { hasDiscount: true, discountTTC: discount.amountTTC } : {}),
  };
}
