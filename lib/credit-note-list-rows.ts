import { roundMoney } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { SaleHistoryListItemDto } from "@/types/operations-dto";

/**
 * A credit note (« avoir ») as a row of the invoice lists (Archives des factures and Factures
 * journalières). Pure - no Prisma client, no `server-only` - so the rules can be tested without a database.
 *
 * What these rows are (and are not):
 *  - the document of a VALIDATED (or later reversed) credit note, with its own number, shown next to the
 *    invoices, payment mode « Rembourser », amount NEGATIVE (money going back);
 *  - INFORMATION ONLY: a credit note is never added to a sale total, a revenue figure, a per-method
 *    breakdown or a refund total here - those keep being computed from the sales and the credit notes
 *    exactly as before (lib/server/sales-history.ts, lib/server/daily-invoices.ts), so nothing is counted twice.
 *
 * Pagination: the lists are cursor-paginated over SALES. Credit notes are attached to the page whose time
 * window covers them (`creditNotePageWindow`): the windows of consecutive pages partition the timeline, so a
 * credit note appears on exactly one page and never twice.
 */

/** Payment « method » of a credit note row. Not a PaymentMethod enum value: never sent to a Sale query. */
export const CREDIT_NOTE_PAYMENT_METHOD = "REFUND";
export const CREDIT_NOTE_PAYMENT_LABEL = "Rembourser";
export const CREDIT_NOTE_LIST_STATUS = "CREDIT_NOTE";
export const CREDIT_NOTE_REVERSED_LIST_STATUS = "CREDIT_NOTE_REVERSED";

/** Upper bound of the credit note rows attached to one page (a day / a page never holds anything near it). */
export const CREDIT_NOTE_ROWS_PER_PAGE_CAP = 200;

export type CreditNoteListRow = {
  id: string;
  creditNoteNumber: string;
  partyType: "CUSTOMER" | "SUPPLIER";
  status: "VALIDATED" | "REVERSED" | "DRAFT";
  /** Amount of the note as stored (lines + rounding share), positive. */
  totalTTC: number;
  validatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; code: string; name: string } | null;
  supplier: { id: string; code: string; name: string } | null;
  createdBy: { fullName: string } | null;
  validatedBy: { fullName: string } | null;
  lines: Array<{ quantity: number }>;
};

/** Is this payment-method filter the « Rembourser » one? */
export function isRefundPaymentFilter(paymentMethod: string | null | undefined): boolean {
  return paymentMethod === CREDIT_NOTE_PAYMENT_METHOD;
}

/**
 * Do credit note rows belong in a list filtered like this? They do for "all payments" and « Rembourser »; never
 * for another payment method (a refund is not paid by cash/cheque/...), and never inside a POS session (a credit
 * note has no session).
 */
export function creditNotesBelongTo(filters: { paymentMethod?: string | null; posSessionId?: string | null }): boolean {
  if (filters.posSessionId) return false;
  const method = filters.paymentMethod;
  return !method || method === "all" || method === CREDIT_NOTE_PAYMENT_METHOD;
}

/** The instant a credit note is dated in the lists: when it was validated (server clock), else created. */
export function creditNoteListInstant(row: Pick<CreditNoteListRow, "validatedAt" | "createdAt">): Date {
  return row.validatedAt ?? row.createdAt;
}

export function mapCreditNoteToListItemDto(row: CreditNoteListRow): SaleHistoryListItemDto {
  const party = row.partyType === "CUSTOMER" ? row.customer : row.supplier;
  const instant = creditNoteListInstant(row).toISOString();
  const refunded = row.partyType === "CUSTOMER" ? -row.totalTTC : 0;
  return {
    id: row.id,
    invoiceNumber: row.creditNoteNumber,
    displayNumber: row.creditNoteNumber,
    posSessionId: null,
    status: row.status === "REVERSED" ? CREDIT_NOTE_REVERSED_LIST_STATUS : CREDIT_NOTE_LIST_STATUS,
    origin: "CREDIT_NOTE",
    customer: party ? { id: party.id, code: party.code, name: party.name } : null,
    driver: null,
    articleCount: row.lines.reduce((sum, line) => sum + line.quantity, 0),
    totalTTC: roundMoney(-row.totalTTC),
    net: roundMoney(-row.totalTTC),
    // The money that left the till for a customer refund (negative); nothing for a supplier note (no cash moves).
    paidAmount: roundMoney(refunded),
    creditAmount: 0,
    paymentMethod: CREDIT_NOTE_PAYMENT_METHOD,
    createdByUserName: row.validatedBy?.fullName ?? row.createdBy?.fullName ?? "",
    createdAt: instant,
    updatedAt: row.updatedAt.toISOString(),
    kind: "CREDIT_NOTE",
    partyType: row.partyType === "CUSTOMER" ? "client" : "fournisseur",
  };
}

/**
 * The time window of the credit notes shown with ONE page of sales (newest first):
 *  - `upper` (exclusive): the previous page's last sale - nothing newer belongs here; null on the first page;
 *  - `lower` (inclusive): this page's last sale when more pages follow, so the next page (whose `upper` is
 *    exactly that instant) starts right under it; null on the last page = everything older.
 */
export function creditNotePageWindow(input: {
  cursorSaleCreatedAt: Date | null;
  pageRows: ReadonlyArray<{ createdAt: Date }>;
  hasMore: boolean;
}): { upper: Date | null; lower: Date | null } {
  const last = input.pageRows[input.pageRows.length - 1];
  return {
    upper: input.cursorSaleCreatedAt,
    lower: input.hasMore && last ? last.createdAt : null,
  };
}

export type CreditNoteListFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Business-day range (Factures journalières): validated in [start, end). */
  range?: { start: Date; end: Date };
  userIds?: readonly string[];
};

function endOfDay(dateOnly: string): Date {
  const date = new Date(dateOnly);
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * The credit notes of a list: validated (or reversed) notes of the organisation, dated by `validatedAt`, with the
 * same search / date / user filters as the sales of that list, inside the page window. Drafts never appear.
 */
export function buildCreditNoteListWhere(
  organizationId: string,
  filters: CreditNoteListFilters,
  window: { upper: Date | null; lower: Date | null } = { upper: null, lower: null },
): Prisma.CreditNoteWhereInput {
  const and: Prisma.CreditNoteWhereInput[] = [{ validatedAt: { not: null } }];
  if (filters.dateFrom) and.push({ validatedAt: { gte: new Date(filters.dateFrom) } });
  if (filters.dateTo) and.push({ validatedAt: { lte: endOfDay(filters.dateTo) } });
  if (filters.range) and.push({ validatedAt: { gte: filters.range.start, lt: filters.range.end } });
  if (window.upper) and.push({ validatedAt: { lt: window.upper } });
  if (window.lower) and.push({ validatedAt: { gte: window.lower } });
  const userIds = [...new Set((filters.userIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (userIds.length) and.push({ createdByUserId: { in: userIds } });
  const search = filters.search?.trim();
  if (search) {
    and.push({
      OR: [
        { creditNoteNumber: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
        { supplier: { name: { contains: search, mode: "insensitive" } } },
        { createdBy: { fullName: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  return { organizationId, status: { in: ["VALIDATED", "REVERSED"] }, AND: and };
}

/** Sales + credit notes of one page, newest first (ties broken by id, descending - the lists' own order). */
export function mergeInvoiceAndCreditNoteRows(
  invoices: SaleHistoryListItemDto[],
  creditNotes: SaleHistoryListItemDto[],
): SaleHistoryListItemDto[] {
  if (creditNotes.length === 0) return invoices;
  return [...invoices, ...creditNotes].sort((a, b) => {
    const delta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (delta !== 0) return delta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
