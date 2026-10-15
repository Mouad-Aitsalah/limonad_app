import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildCreditNoteListWhere,
  CREDIT_NOTE_ROWS_PER_PAGE_CAP,
  mapCreditNoteToListItemDto,
  type CreditNoteListFilters,
  type CreditNoteListRow,
} from "@/lib/credit-note-list-rows";
import type { SaleHistoryListItemDto } from "@/types/operations-dto";

/**
 * Database side of the credit note rows of the invoice lists (see lib/credit-note-list-rows.ts for the rules).
 * Read only, and always scoped to the caller's organisation (`organizationId` comes from the session).
 */

const creditNoteListSelect = {
  id: true,
  creditNoteNumber: true,
  partyType: true,
  status: true,
  totalTTC: true,
  validatedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true } },
  createdBy: { select: { fullName: true } },
  validatedBy: { select: { fullName: true } },
  lines: { select: { quantity: true } },
} as const;

/** The credit notes of a page window, newest first, as list rows. */
export async function loadCreditNoteListItems(
  organizationId: string,
  filters: CreditNoteListFilters,
  window: { upper: Date | null; lower: Date | null },
): Promise<SaleHistoryListItemDto[]> {
  const rows = await prisma.creditNote.findMany({
    where: buildCreditNoteListWhere(organizationId, filters, window),
    select: creditNoteListSelect,
    orderBy: [{ validatedAt: "desc" }, { id: "desc" }],
    take: CREDIT_NOTE_ROWS_PER_PAGE_CAP,
  });
  return rows.map((row) =>
    mapCreditNoteToListItemDto({
      ...row,
      totalTTC: row.totalTTC.toNumber(),
    } satisfies CreditNoteListRow),
  );
}

/** How many credit notes match the filters, whatever the page (added to the lists' "total"). */
export async function countCreditNoteListItems(
  organizationId: string,
  filters: CreditNoteListFilters,
): Promise<number> {
  return prisma.creditNote.count({ where: buildCreditNoteListWhere(organizationId, filters) });
}

/** The instant of the sale a page cursor points at (the previous page's last sale), or null if it is gone. */
export async function loadCursorSaleInstant(organizationId: string, cursorSaleId: string): Promise<Date | null> {
  const sale = await prisma.sale.findFirst({
    where: { id: cursorSaleId, organizationId },
    select: { createdAt: true },
  });
  return sale?.createdAt ?? null;
}
