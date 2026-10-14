import "server-only";

import { roundMoney } from "@/lib/money";
import { businessDayRangeUtc, formatBusinessDayLabel } from "@/lib/business-day";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { canSeeDailyMargin, groupDailySales, summarizeMargin } from "@/lib/daily-sales-grouping";
import { canSeeDiscountIndicator } from "@/lib/sale-discount-indicator";
import { mapOrderRowToListItemDto, orderListSelect } from "@/lib/server/sales-history";
import type {
  DailyInvoicesPageDto,
  DailyMarginDto,
  DailyRevenueByMethodDto,
  DailySalesGroupingDto,
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

/** The query parameters of /api/daily-invoices and /api/daily-invoices/sales-grouping (same filters). */
export function dailyParamsFromSearchParams(searchParams: URLSearchParams): DailyInvoicesPageParams {
  const pageSizeParam = searchParams.get("pageSize");
  const userIdsParam = searchParams.get("userIds");
  return {
    day: searchParams.get("day") || undefined,
    cursor: searchParams.get("cursor") || undefined,
    pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
    userIds: userIdsParam
      ? userIdsParam.split(",").map((value) => value.trim()).filter(Boolean)
      : undefined,
    paymentMethod: searchParams.get("paymentMethod") || undefined,
  };
}

/**
 * The sales of the page: one business day, sold statuses, the « Utilisateur » and
 * « Mode de règlement » filters. ONE definition shared by the CA total, the margin
 * and the sales grouping, so they always cover exactly the same invoices.
 */
export function buildDailyScope(organizationId: string, params: DailyInvoicesPageParams) {
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
  return { day, start, end, saleWhere };
}

// SaleLine.unitCostHT is exact for every line created once this migration had run;
// older lines carry a back-filled approximation (see the migration). The instant is
// read from the database's own migration history; when it cannot be read, the end of
// the business day 2026-09-04 is used - later than any possible run, so conservative.
const UNIT_COST_SNAPSHOT_MIGRATION = "20260904130000_add_saleline_unit_cost_ht";
const UNIT_COST_SNAPSHOT_FALLBACK = new Date("2026-09-05T01:00:00.000Z");
let unitCostReliableSince: Date | null = null;

async function loadUnitCostReliableSince(): Promise<Date> {
  if (unitCostReliableSince) return unitCostReliableSince;
  try {
    const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null }>>`
      SELECT finished_at FROM "_prisma_migrations"
      WHERE migration_name = ${UNIT_COST_SNAPSHOT_MIGRATION} AND rolled_back_at IS NULL AND finished_at IS NOT NULL
      ORDER BY finished_at DESC LIMIT 1`;
    const finishedAt = rows[0]?.finished_at;
    if (finishedAt) {
      unitCostReliableSince = new Date(finishedAt);
      return unitCostReliableSince;
    }
  } catch {
    // the fallback below is conservative; nothing is logged (no data to expose)
  }
  return UNIT_COST_SNAPSHOT_FALLBACK;
}

/** Margin of the scope - only ever called for a role allowed to see margins. */
async function loadDailyMargin(saleWhere: Prisma.SaleWhereInput): Promise<DailyMarginDto> {
  const [lines, reliableSince] = await Promise.all([
    prisma.saleLine.findMany({
      where: { sale: { is: saleWhere } },
      select: { quantity: true, totalHT: true, unitCostHT: true, createdAt: true },
    }),
    loadUnitCostReliableSince(),
  ]);
  return summarizeMargin(
    lines.map((line) => ({
      quantity: line.quantity,
      totalHT: line.totalHT.toNumber(),
      unitCostHT: line.unitCostHT.toNumber(),
      createdAt: line.createdAt,
    })),
    reliableSince,
  );
}

type GroupingLineRow = {
  productId: string;
  quantity: number;
  totalTTC: Prisma.Decimal;
  totalHT: Prisma.Decimal;
  createdAt: Date;
  product: { name: string; reference: string };
  unitCostHT?: Prisma.Decimal;
};

/**
 * « Regroupement des ventes »: the lines of the page's scope grouped by product and
 * by unit price TTC really applied (lib/daily-sales-grouping.ts). Same roles as the
 * page; the margin - and the cost column itself - only for a role allowed to see it.
 */
export async function getDailySalesGrouping(
  params: DailyInvoicesPageParams = {},
): Promise<DailySalesGroupingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const includeMargin = canSeeDailyMargin(user.role);
  const { day, saleWhere } = buildDailyScope(user.organizationId, params);

  const lineSelect = {
    productId: true,
    quantity: true,
    totalTTC: true,
    totalHT: true,
    createdAt: true,
    product: { select: { name: true, reference: true } },
  } as const;
  const linesQuery: Promise<GroupingLineRow[]> = includeMargin
    ? prisma.saleLine.findMany({ where: { sale: { is: saleWhere } }, select: { ...lineSelect, unitCostHT: true } })
    : prisma.saleLine.findMany({ where: { sale: { is: saleWhere } }, select: lineSelect });

  const [lines, invoiceCount, sums, reliableSince] = await Promise.all([
    linesQuery,
    prisma.sale.count({ where: saleWhere }),
    prisma.sale.aggregate({ where: saleWhere, _sum: { totalTTC: true, roundingAmount: true } }),
    includeMargin ? loadUnitCostReliableSince() : Promise.resolve(null),
  ]);

  const grouping = groupDailySales(
    lines.map((line) => ({
      productId: line.productId,
      productName: line.product.name,
      productReference: line.product.reference,
      quantity: line.quantity,
      totalTTC: line.totalTTC.toNumber(),
      totalHT: line.totalHT.toNumber(),
      ...(includeMargin && line.unitCostHT ? { unitCostHT: line.unitCostHT.toNumber() } : {}),
      createdAt: line.createdAt,
    })),
    {
      includeMargin,
      reliableSince,
      roundingTotal: roundMoney(sums._sum.roundingAmount?.toNumber() ?? 0),
      revenueTotal: roundMoney(sums._sum.totalTTC?.toNumber() ?? 0),
    },
  );

  return {
    day,
    dayLabel: formatBusinessDayLabel(day),
    invoiceCount,
    products: grouping.products,
    totals: grouping.totals,
    ...(grouping.margin ? { margin: grouping.margin } : {}),
  };
}

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
  const { start, end, day, saleWhere } = buildDailyScope(organizationId, params);

  const [rows, invoiceCount, revenueAgg, creditAgg, paymentGroups, userRows, margin] = await Promise.all([
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
    // Margin: admin only - for every other role no cost is read and no field is sent.
    canSeeDailyMargin(user.role) ? loadDailyMargin(saleWhere) : Promise.resolve(undefined),
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
    mapOrderRowToListItemDto(row, row.totalTTC.toNumber() - (refundsBySaleId.get(row.id) ?? 0), {
      includeDiscount: canSeeDiscountIndicator(user.role),
    }),
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
      ...(margin ? { margin } : {}),
    },
    userOptions: userRows.map((row) => ({ id: row.id, name: row.fullName?.trim() || row.email })),
  };
}
