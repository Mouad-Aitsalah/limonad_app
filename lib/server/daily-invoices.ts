import "server-only";

import { roundMoney } from "@/lib/money";
import { businessDayRangeUtc, formatBusinessDayLabel } from "@/lib/business-day";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { mapOrderRowToListItemDto, orderListSelect } from "@/lib/server/sales-history";
import type {
  DailyInvoicesPageDto,
  DailyRevenueByMethodDto,
} from "@/types/daily-invoice";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// Sold, revenue-bearing invoices - the exact scope Archives uses for its
// totals (`postedSaleStatuses`): DRAFT and CANCELLED never contribute.
const SOLD_STATUS: Prisma.SaleWhereInput["status"] = { notIn: ["DRAFT", "CANCELLED"] };

// PaymentMethod enum values accepted by the "Mode de règlement" filter, with
// the same French labels as the Archives toolbar (kept local to avoid a
// server->client-module import; both lists must stay in sync).
const METHOD_LABEL: Record<string, string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CHECK: "Chèque",
  BANK_TRANSFER: "Virement",
  CREDIT: "Crédit",
  MIXED: "Mixte",
};
const PAYMENT_METHOD_VALUES = new Set(Object.keys(METHOD_LABEL));
// Cards always shown (in this order), even at 0; other buckets appear only
// when non-zero.
const CORE_METHOD_ORDER = ["CASH", "BANK_TRANSFER", "CHECK", "CREDIT"];
const EXTRA_METHOD_ORDER = ["CARD", "MIXED"];

export type DailyInvoicesPageParams = {
  /** Business day "YYYY-MM-DD"; defaults to the current one (02:00 cutoff). */
  day?: string;
  cursor?: string | null;
  pageSize?: number;
  /** OR filter on Sale.createdByUserId. Empty = all users. */
  userIds?: string[];
  /** Exact Sale.paymentMethod; anything else = all methods. */
  paymentMethod?: string;
};

function clampPageSize(value: number | undefined): number {
  const requested = Math.trunc(value ?? DEFAULT_PAGE_SIZE);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}

function buildByMethod(
  paymentSums: Map<string, number>,
  creditTotal: number,
): DailyRevenueByMethodDto[] {
  const buckets = new Map<string, number>(paymentSums);
  if (creditTotal > 0) {
    buckets.set("CREDIT", roundMoney((buckets.get("CREDIT") ?? 0) + creditTotal));
  }

  const ordered: DailyRevenueByMethodDto[] = [];
  for (const method of CORE_METHOD_ORDER) {
    ordered.push({ method, label: METHOD_LABEL[method], amount: roundMoney(buckets.get(method) ?? 0) });
    buckets.delete(method);
  }
  for (const method of EXTRA_METHOD_ORDER) {
    const amount = roundMoney(buckets.get(method) ?? 0);
    buckets.delete(method);
    if (amount !== 0) ordered.push({ method, label: METHOD_LABEL[method] ?? method, amount });
  }
  // Any unforeseen method value still surfaces rather than silently vanishing.
  for (const [method, raw] of buckets) {
    const amount = roundMoney(raw);
    if (amount !== 0) ordered.push({ method, label: METHOD_LABEL[method] ?? method, amount });
  }
  return ordered;
}

/**
 * "Factures journalières": the invoices sold during one business day
 * (02:00 -> 02:00, Africa/Casablanca), with a CA total + per-method
 * breakdown computed over EVERY matching invoice, not just the page.
 * Reuses the Archives row shape (orderListSelect / mapOrderRowToListItemDto)
 * so <InvoicesTable> renders it unchanged.
 */
export async function getDailyInvoicesPage(
  params: DailyInvoicesPageParams = {},
): Promise<DailyInvoicesPageDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = user.organizationId;

  const pageSize = clampPageSize(params.pageSize);
  const { start, end, day } = businessDayRangeUtc(params.day ?? "");
  const userIds = [...new Set((params.userIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const methodFilter =
    params.paymentMethod && PAYMENT_METHOD_VALUES.has(params.paymentMethod)
      ? (params.paymentMethod as NonNullable<Prisma.SaleWhereInput["paymentMethod"]>)
      : null;

  const saleWhere: Prisma.SaleWhereInput = {
    organizationId,
    createdAt: { gte: start, lt: end },
    status: SOLD_STATUS,
    ...(userIds.length ? { createdByUserId: { in: userIds } } : {}),
    ...(methodFilter ? { paymentMethod: methodFilter } : {}),
  };

  const [rows, invoiceCount, revenueAgg, creditAgg, paymentGroups, userRows] = await Promise.all([
    prisma.sale.findMany({
      where: saleWhere,
      select: orderListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    prisma.sale.count({ where: saleWhere }),
    prisma.sale.aggregate({ where: saleWhere, _sum: { totalTTC: true } }),
    prisma.sale.aggregate({ where: saleWhere, _sum: { creditAmount: true } }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { organizationId, status: "VALIDATED", sale: { is: saleWhere } },
      _sum: { amount: true },
    }),
    prisma.user.findMany({
      where: { organizationId },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  // `net` (= totalTTC − validated customer credit notes) only for the sale
  // ids on this page - mirrors getSalesOrdersPage, never the whole history.
  const saleIds = pageRows.map((row) => row.id);
  const refundRows = saleIds.length
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

  const items = pageRows.map((row) =>
    mapOrderRowToListItemDto(row, row.totalTTC.toNumber() - (refundsBySaleId.get(row.id) ?? 0)),
  );

  const paymentSums = new Map<string, number>();
  for (const group of paymentGroups) {
    paymentSums.set(group.method, roundMoney(group._sum.amount?.toNumber() ?? 0));
  }
  const revenueTotal = roundMoney(revenueAgg._sum.totalTTC?.toNumber() ?? 0);
  const creditTotal = roundMoney(creditAgg._sum.creditAmount?.toNumber() ?? 0);
  const byMethod = buildByMethod(paymentSums, creditTotal);
  const breakdownTotal = roundMoney(byMethod.reduce((sum, bucket) => sum + bucket.amount, 0));

  return {
    day,
    dayLabel: formatBusinessDayLabel(day),
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    items,
    nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    hasMore,
    totalCount: invoiceCount,
    kpis: {
      invoiceCount,
      revenueTotal,
      byMethod,
      breakdownTotal,
      reconciled: Math.abs(breakdownTotal - revenueTotal) < 0.01,
    },
    userOptions: userRows.map((row) => ({ id: row.id, name: row.fullName?.trim() || row.email })),
  };
}
