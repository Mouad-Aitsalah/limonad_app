import type { Prisma } from "@/lib/generated/prisma/client";

// Pure (no `server-only`, no Prisma client) so the archive filter can be unit
// tested. Used by lib/server/sales-history.ts.

export type SalesOrdersPageParams = {
  cursor?: string | null;
  pageSize?: number;
  /** Matches invoiceNumber, customer name, driver name, or the creating
   * user's name - the same fields the pre-Phase-3 client-side filter
   * checked, except the legacy `saleNumber/saleYear` display format (e.g.
   * "4/2026"), which isn't a real column and can't be searched server-side
   * without reconstructing it in SQL - out of scope, see the Phase 3
   * report; invoiceNumber itself (every live VC-/VD- sale) is unaffected. */
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  posSessionId?: string;
  /**
   * Archives des factures never list DRAFT (BROUILLON) sales: they are
   * filtered out in the query itself, so `totalCount` / pagination only count
   * listable invoices. Internal callers that must still find a draft by
   * reference (e.g. the AI assistant's invoice lookup) can opt back in; no
   * HTTP route forwards this flag.
   */
  includeDrafts?: boolean;
};

function endOfDay(dateOnly: string): Date {
  const date = new Date(dateOnly);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function buildOrdersWhere(
  organizationId: string,
  params: SalesOrdersPageParams,
): Prisma.SaleWhereInput {
  const where: Prisma.SaleWhereInput = { organizationId };

  if (!params.includeDrafts) {
    where.status = { not: "DRAFT" };
  }
  if (params.posSessionId) {
    where.posSessionId = params.posSessionId;
  }
  if (params.paymentMethod && params.paymentMethod !== "all") {
    where.paymentMethod = params.paymentMethod as Prisma.SaleWhereInput["paymentMethod"];
  }
  if (params.dateFrom || params.dateTo) {
    where.createdAt = {
      ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
      ...(params.dateTo ? { lte: endOfDay(params.dateTo) } : {}),
    };
  }
  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { customer: { name: { contains: search, mode: "insensitive" } } },
      { driver: { user: { fullName: { contains: search, mode: "insensitive" } } } },
      { createdBy: { fullName: { contains: search, mode: "insensitive" } } },
    ];
  }

  return where;
}
