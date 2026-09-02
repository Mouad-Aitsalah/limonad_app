import "server-only";

import { roundMoney as roundMoneyDecimal } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type {
  PosSessionDto,
  SaleHistoryListItemDto,
  SaleHistoryOrdersPageDto,
  SalesMonthDto,
} from "@/types/operations-dto";

const monthLabels = [
  "Janvier",
  "Fevrier",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Aout",
  "Septembre",
  "Octobre",
  "Novembre",
  "Decembre",
];

const ORDERS_DEFAULT_PAGE_SIZE = 25;
const ORDERS_MAX_PAGE_SIZE = 100;

// F8-C: delegates to the shared decimal-based engine (lib/money.ts).
function roundMoney(value: number) {
  return roundMoneyDecimal(value);
}

/**
 * A sale is "valid" for revenue purposes once it left DRAFT and was not
 * cancelled. CREDIT_NOTED sales still count their original totalTTC toward
 * "Total ventes" - the matching credit note is subtracted separately via
 * "Total remboursements", per the Total net = ventes - remboursements rule.
 */
const postedSaleStatuses: Prisma.SaleWhereInput["status"] = { notIn: ["DRAFT", "CANCELLED"] };

function endOfDay(dateOnly: string): Date {
  const date = new Date(dateOnly);
  date.setHours(23, 59, 59, 999);
  return date;
}

const orderListSelect = {
  id: true,
  invoiceNumber: true,
  saleYear: true,
  saleNumber: true,
  posSessionId: true,
  status: true,
  totalTTC: true,
  paidAmount: true,
  creditAmount: true,
  paymentMethod: true,
  createdAt: true,
  customer: { select: { id: true, code: true, name: true } },
  driver: { select: { id: true, user: { select: { fullName: true } } } },
  createdBy: { select: { fullName: true } },
  lines: { select: { quantity: true } },
} as const;

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
};

function clampPageSize(pageSize: number | undefined): number {
  const requested = Math.trunc(pageSize ?? ORDERS_DEFAULT_PAGE_SIZE);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, ORDERS_MAX_PAGE_SIZE)
    : ORDERS_DEFAULT_PAGE_SIZE;
}

function buildOrdersWhere(
  organizationId: string,
  params: SalesOrdersPageParams,
): Prisma.SaleWhereInput {
  const where: Prisma.SaleWhereInput = { organizationId };

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

function mapOrderRowToListItemDto(
  row: Prisma.SaleGetPayload<{ select: typeof orderListSelect }>,
  net: number,
): SaleHistoryListItemDto {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    displayNumber:
      row.saleYear !== null && row.saleNumber !== null
        ? `${row.saleNumber}/${row.saleYear}`
        : row.invoiceNumber,
    posSessionId: row.posSessionId,
    status: row.status,
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
  };
}

/**
 * Phase 3 rewrite of what used to be getSalesHistory()'s `orders` half: the
 * original fetched EVERY sale in the organization through saleInclude (full
 * lines + payments + every relation), unbounded, then filtered/paginated
 * entirely client-side (see the Phase 3 audit / report). This version
 * selects only what the Commandes table actually renders, applies every
 * filter (date range, payment method, session, search) server-side, and
 * paginates with a cursor - the multi-tenant scoping
 * (`organizationId: currentUser.organizationId`, never client input) is
 * untouched from the fix earlier in Phase 3 and is the first thing applied
 * to every query below.
 *
 * Cursor: `id`, paired with `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`
 * for a fully deterministic order, exactly the same pattern already
 * verified (0 duplicates/gaps across a 1000-row walk) for
 * getLoadingHistoryPage in the previous Phase 3 chantier.
 */
export async function getSalesOrdersPage(
  params: SalesOrdersPageParams = {},
): Promise<SaleHistoryOrdersPageDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = currentUser.organizationId;
  const pageSize = clampPageSize(params.pageSize);
  const where = buildOrdersWhere(organizationId, params);

  const [rows, totalCount] = await Promise.all([
    prisma.sale.findMany({
      where,
      select: orderListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    prisma.sale.count({ where }),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  // Refunds looked up only for the sale ids actually on this page - never
  // the whole organization's credit notes just to compute `net` for one
  // page (see the original code's unbounded refundRows fetch, now scoped
  // to getSalesSessionsSummary/getSalesMonthsSummary below, where a
  // time-range/whole-history correlation is genuinely needed).
  const saleIds = pageRows.map((row) => row.id);
  const refundRows =
    saleIds.length > 0
      ? await prisma.creditNote.findMany({
          where: {
            organizationId,
            partyType: "CUSTOMER",
            status: "VALIDATED",
            originalSaleId: { in: saleIds },
          },
          select: { originalSaleId: true, totalTTC: true },
        })
      : [];
  const refundsBySaleId = new Map<string, number>();
  for (const refund of refundRows) {
    if (!refund.originalSaleId) continue;
    refundsBySaleId.set(
      refund.originalSaleId,
      (refundsBySaleId.get(refund.originalSaleId) ?? 0) + refund.totalTTC.toNumber(),
    );
  }

  return {
    items: pageRows.map((row) =>
      mapOrderRowToListItemDto(row, row.totalTTC.toNumber() - (refundsBySaleId.get(row.id) ?? 0)),
    ),
    nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    hasMore,
    totalCount,
  };
}

/**
 * Phase 3 rewrite of getSalesHistory()'s `sessions` half. ordersCount/
 * totalSales per session used to come from filtering the FULL unbounded
 * orders array once per session (O(sessions x orders) in JS, on top of the
 * heavy saleInclude fetch) - now one groupBy query. totalRefunds keeps the
 * exact same time-window correlation as before (a refund belongs to
 * whichever session was open when it was validated - CreditNote has no
 * posSessionId of its own to join on directly) - deliberately unchanged,
 * this rewrite touches performance, not business logic.
 */
export async function getSalesSessionsSummary(): Promise<PosSessionDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = currentUser.organizationId;

  const [sessionRecords, orderAggregates, refundRows] = await Promise.all([
    prisma.posSession.findMany({ where: { organizationId }, orderBy: { number: "desc" } }),
    prisma.sale.groupBy({
      by: ["posSessionId"],
      where: { organizationId, status: postedSaleStatuses, posSessionId: { not: null } },
      _count: { id: true },
      _sum: { totalTTC: true },
    }),
    prisma.creditNote.findMany({
      where: { organizationId, partyType: "CUSTOMER", status: "VALIDATED" },
      select: { totalTTC: true, validatedAt: true },
    }),
  ]);

  const aggregateBySessionId = new Map(
    orderAggregates
      .filter((row): row is typeof row & { posSessionId: string } => row.posSessionId !== null)
      .map((row) => [
        row.posSessionId,
        { count: row._count.id, sum: row._sum.totalTTC?.toNumber() ?? 0 },
      ]),
  );

  return sessionRecords.map((session): PosSessionDto => {
    const aggregate = aggregateBySessionId.get(session.id);
    const rangeStart = session.openedAt;
    const rangeEnd = session.closedAt ?? null;

    const totalSales = roundMoney(aggregate?.sum ?? 0);
    const totalRefunds = roundMoney(
      refundRows.reduce((sum, refund) => {
        if (!refund.validatedAt) return sum;
        const inRange =
          refund.validatedAt >= rangeStart && (rangeEnd === null || refund.validatedAt < rangeEnd);
        return inRange ? sum + refund.totalTTC.toNumber() : sum;
      }, 0),
    );

    return {
      id: session.id,
      number: session.number,
      year: session.year,
      displayNumber: `POS/${session.number}`,
      openedAt: session.openedAt.toISOString(),
      closedAt: session.closedAt?.toISOString() ?? null,
      status: session.status,
      ordersCount: aggregate?.count ?? 0,
      totalSales,
      totalRefunds,
      totalNet: roundMoney(totalSales - totalRefunds),
    };
  });
}

/**
 * Phase 3 rewrite of getSalesHistory()'s `months` half. Still groups in
 * JS (Prisma's groupBy can't group by a truncated date expression without
 * raw SQL, and months are a small, bounded result set regardless of sale
 * volume) - but the fetch backing that JS loop now selects only
 * {createdAt, totalTTC} instead of the full saleInclude (lines, payments,
 * every relation), which was the actual dominant cost, not the grouping
 * itself. See the Phase 3 report for the measured impact and the raw-SQL
 * date_trunc alternative considered for a fully O(1) version.
 */
export async function getSalesMonthsSummary(): Promise<SalesMonthDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = currentUser.organizationId;

  const [orderRows, refundRows] = await Promise.all([
    prisma.sale.findMany({
      where: { organizationId, status: postedSaleStatuses },
      select: { createdAt: true, totalTTC: true },
    }),
    prisma.creditNote.findMany({
      where: { organizationId, partyType: "CUSTOMER", status: "VALIDATED" },
      select: { totalTTC: true, validatedAt: true },
    }),
  ]);

  const monthMap = new Map<
    string,
    { year: number; monthNumber: number; ordersCount: number; totalSales: number }
  >();
  for (const order of orderRows) {
    const year = order.createdAt.getFullYear();
    const monthNumber = order.createdAt.getMonth() + 1;
    const key = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const existing = monthMap.get(key) ?? { year, monthNumber, ordersCount: 0, totalSales: 0 };
    existing.ordersCount += 1;
    existing.totalSales += order.totalTTC.toNumber();
    monthMap.set(key, existing);
  }

  const refundsByMonth = new Map<string, number>();
  for (const refund of refundRows) {
    if (!refund.validatedAt) continue;
    const key = `${refund.validatedAt.getFullYear()}-${String(refund.validatedAt.getMonth() + 1).padStart(2, "0")}`;
    refundsByMonth.set(key, (refundsByMonth.get(key) ?? 0) + refund.totalTTC.toNumber());
  }
  for (const key of refundsByMonth.keys()) {
    if (!monthMap.has(key)) {
      const [yearPart, monthPart] = key.split("-");
      monthMap.set(key, {
        year: Number(yearPart),
        monthNumber: Number(monthPart),
        ordersCount: 0,
        totalSales: 0,
      });
    }
  }

  return Array.from(monthMap.entries())
    .map(([key, value]): SalesMonthDto => {
      const totalSales = roundMoney(value.totalSales);
      const totalRefunds = roundMoney(refundsByMonth.get(key) ?? 0);
      return {
        key,
        monthNumber: value.monthNumber,
        year: value.year,
        displayNumber: `${value.monthNumber}/${value.year}`,
        label: `${value.monthNumber}/${value.year} - ${monthLabels[value.monthNumber - 1]} ${value.year}`,
        ordersCount: value.ordersCount,
        totalSales,
        totalRefunds,
        totalNet: roundMoney(totalSales - totalRefunds),
      };
    })
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}
