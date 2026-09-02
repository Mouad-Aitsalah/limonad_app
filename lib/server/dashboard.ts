import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { PurchaseStatus, SaleStatus } from "@/lib/generated/prisma/client";
import { roundMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";

const postedSaleStatuses = ["VALIDATED", "PARTIALLY_PAID", "PAID", "CREDIT"] satisfies SaleStatus[];
const purchaseStatuses = ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"] satisfies PurchaseStatus[];

export type DashboardMetric = {
  id: string;
  eyebrow: string;
  title: string;
  value: string;
  helper: string;
  accent: "green" | "blue" | "teal" | "orange" | "red" | "navy";
  trend?: {
    value: string;
    direction: "up" | "down" | "neutral";
  };
};

export type DashboardHeroCard = {
  eyebrow: string;
  title: string;
  description: string;
};

export type DashboardTrendPoint = {
  date: string;
  ventes: number;
};

export type DashboardCategoryPoint = {
  category: string;
  value: number;
  color: string;
};

export type DashboardTopProduct = {
  id: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: string;
};

export type DashboardStockAlert = {
  id: string;
  product: string;
  sku: string;
  quantity: number;
  threshold: number;
  severity: "critique" | "faible";
};

export type DashboardRecentSale = {
  id: string;
  client: string;
  date: string;
  amount: string;
  status: "PAID" | "PARTIALLY_PAID" | "CREDIT" | "VALIDATED" | "CANCELLED";
};

export type DashboardData = {
  heroCards: DashboardHeroCard[];
  metrics: DashboardMetric[];
  salesTrend: DashboardTrendPoint[];
  categorySales: DashboardCategoryPoint[];
  topProducts: DashboardTopProduct[];
  stockAlerts: DashboardStockAlert[];
  recentSales: DashboardRecentSale[];
};

/**
 * Phase 3: was 7 queries, 3 of them fully unbounded findMany's whose only
 * purpose was to compute a SUM/COUNT/GROUP BY that PostgreSQL can do
 * directly - see the Phase 3 report for the exact "before" evidence
 * (salesLast30/salesLast14/salesLinesLast30 each loaded every matching row
 * into Node just to reduce() them in JS, and getStockSummary()/
 * getStockLevels() together loaded the ENTIRE StockLevel table twice).
 * Replaced by 9 small, targeted, DB-aggregated queries (2 native Prisma
 * .aggregate() calls, 1 native Prisma .groupBy(), 4 raw-SQL aggregates for
 * the joins/date-truncation Prisma can't express, plus the 2 queries that
 * were already bounded/optimal and are unchanged: the 5-row recentSales
 * findMany and the 1-row purchase .aggregate()). Every query keeps the
 * EXACT SAME organizationId = sessionUser.organizationId scoping as
 * before - see the multi-tenant tests in the Phase 3 report for proof this
 * critical fix was not touched.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = currentUser.organizationId;

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const last7Start = addDays(today, -6);
  const previous7Start = addDays(today, -13);
  const previous7End = addDays(today, -6);
  const last30Start = addDays(today, -29);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    last7Agg,
    previous7Agg,
    salesLatest,
    salesTrendRows,
    topProductGroups,
    categoryRows,
    purchasesMonth,
    stockSnapshot,
    stockAlertRows,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { organizationId, createdAt: { gte: last7Start, lt: tomorrow }, status: { in: postedSaleStatuses } },
      _sum: { totalTTC: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: {
        organizationId,
        createdAt: { gte: previous7Start, lt: previous7End },
        status: { in: postedSaleStatuses },
      },
      _sum: { totalTTC: true },
      _count: true,
    }),
    prisma.sale.findMany({
      where: {
        organizationId,
        status: { in: postedSaleStatuses },
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalTTC: true,
        createdAt: true,
        status: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    getSalesTrendByDay(organizationId, last30Start, tomorrow),
    prisma.saleLine.groupBy({
      by: ["productId"],
      where: { sale: { organizationId, createdAt: { gte: last30Start, lt: tomorrow }, status: { in: postedSaleStatuses } } },
      _sum: { quantity: true, totalTTC: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    getCategoryRevenueShare(organizationId, last30Start, tomorrow),
    prisma.purchase.aggregate({
      where: {
        organizationId,
        orderDate: { gte: monthStart, lt: tomorrow },
        status: { in: purchaseStatuses },
      },
      _sum: { totalTTC: true },
    }),
    getDashboardStockSnapshot(organizationId),
    getDashboardStockAlerts(organizationId),
  ]);

  // topProductGroups only carries productId + aggregates - fetch name/
  // category for just those <=5 ids (never the whole catalog).
  const topProductDetails = topProductGroups.length
    ? await prisma.product.findMany({
        where: { id: { in: topProductGroups.map((group) => group.productId) }, organizationId },
        select: { id: true, name: true, category: { select: { name: true } } },
      })
    : [];
  const topProductDetailsById = new Map(topProductDetails.map((product) => [product.id, product]));

  const revenueLast7 = roundTo2(last7Agg._sum.totalTTC?.toNumber() ?? 0);
  const revenuePrevious7 = roundTo2(previous7Agg._sum.totalTTC?.toNumber() ?? 0);
  const salesCountLast7 = last7Agg._count;
  const salesCountPrevious7 = previous7Agg._count;
  const avgLast7 = salesCountLast7 > 0 ? revenueLast7 / salesCountLast7 : 0;
  const avgPrevious7 = salesCountPrevious7 > 0 ? revenuePrevious7 / salesCountPrevious7 : 0;
  const monthCharges = purchasesMonth._sum.totalTTC?.toNumber() ?? 0;

  const heroCards: DashboardHeroCard[] = [
    {
      eyebrow: "Business Snapshot",
      title: "COMDIS",
      description: `${salesCountLast7} ventes validees sur les 7 derniers jours.`,
    },
    {
      eyebrow: "System Status",
      title: "Operations stables",
      description: `${stockSnapshot.lowStockCount} seuils bas et ${stockSnapshot.outOfStockCount} ruptures a surveiller.`,
    },
    {
      eyebrow: "Today Focus",
      title: "Dashboard",
      description: `${formatMoney(monthCharges)} d'approvisionnements en cours ce mois-ci.`,
    },
  ];

  const metrics: DashboardMetric[] = [
    {
      id: "revenue",
      eyebrow: "Revenue",
      title: "7 derniers jours",
      value: formatMoney(revenueLast7),
      helper: "Chiffre d'affaires valide sur la periode.",
      accent: "blue",
      trend: buildTrend(revenueLast7, revenuePrevious7),
    },
    {
      id: "sales-count",
      eyebrow: "Transactions",
      title: "Nombre de ventes",
      value: salesCountLast7.toLocaleString("fr-FR"),
      helper: "Factures enregistrees et confirmees.",
      accent: "green",
      trend: buildTrend(salesCountLast7, salesCountPrevious7, { suffix: " vs semaine precedente" }),
    },
    {
      id: "basket",
      eyebrow: "Panier moyen",
      title: "Valeur moyenne",
      value: formatMoney(avgLast7),
      helper: "Montant moyen par facture.",
      accent: "teal",
      trend: buildTrend(avgLast7, avgPrevious7),
    },
    {
      id: "stock",
      eyebrow: "Stock",
      title: "Valeur du stock",
      value: formatMoney(stockSnapshot.totalValue),
      helper: `${stockSnapshot.productCount.toLocaleString("fr-FR")} produits suivis sur l'ensemble des emplacements.`,
      accent: "orange",
    },
    {
      id: "charges",
      eyebrow: "Charges du mois",
      title: "Achats et approvisionnements",
      value: formatMoney(monthCharges),
      helper: "Total des achats non annules du mois en cours.",
      accent: "red",
    },
  ];

  // salesTrendRows is already a <=30-row, per-day SUM computed in
  // PostgreSQL (getSalesTrendByDay) - this just fills in the days with zero
  // sales so the chart always shows exactly 30 points, same as before.
  const salesByDay = new Map<string, number>();
  for (let index = 0; index < 30; index += 1) {
    const day = addDays(last30Start, index);
    salesByDay.set(day.toISOString().slice(0, 10), 0);
  }
  for (const row of salesTrendRows) {
    const key = row.day.toISOString().slice(0, 10);
    salesByDay.set(key, row.total);
  }
  const salesTrend = Array.from(salesByDay.entries()).map(([isoDate, amount]) => ({
    date: formatShortDate(new Date(`${isoDate}T00:00:00`)),
    ventes: roundTo2(amount),
  }));

  const categoryColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
  const grandTotalRevenue = categoryRows[0]?.grandTotal ?? 0;
  const categorySales = categoryRows.map((row, index) => ({
    category: row.category,
    value: grandTotalRevenue > 0 ? roundTo2((row.revenue / grandTotalRevenue) * 100) : 0,
    color: categoryColors[index % categoryColors.length],
  }));

  const topProducts = topProductGroups
    .map((group): DashboardTopProduct | null => {
      const details = topProductDetailsById.get(group.productId);
      if (!details) return null;
      return {
        id: group.productId,
        name: details.name,
        category: details.category.name,
        unitsSold: group._sum.quantity ?? 0,
        revenue: formatMoney(group._sum.totalTTC?.toNumber() ?? 0),
      };
    })
    .filter((product): product is DashboardTopProduct => product !== null);

  const stockAlerts: DashboardStockAlert[] = stockAlertRows.map((row) => ({
    id: row.id,
    product: row.productName,
    sku: row.productReference,
    quantity: row.availableQuantity,
    threshold: row.minimumStock,
    severity: row.availableQuantity === 0 ? "critique" : "faible",
  }));

  const recentSales = salesLatest.map((sale) => ({
    id: sale.invoiceNumber,
    client: sale.customer?.name ?? "Client comptoir",
    date: formatLongDate(sale.createdAt),
    amount: formatMoney(sale.totalTTC.toNumber()),
    status: sale.status as DashboardRecentSale["status"],
  }));

  return {
    heroCards,
    metrics,
    salesTrend,
    categorySales,
    topProducts,
    stockAlerts,
    recentSales,
  };
}

/**
 * One SUM(totalTTC) per calendar day over the window, computed in
 * PostgreSQL via date_trunc - Prisma's groupBy cannot group by a truncated/
 * derived date, so this is the one place a raw query is genuinely needed
 * (per the chantier's own guidance). Days with zero sales simply don't
 * appear in the result - the caller fills those in, same as before.
 */
async function getSalesTrendByDay(organizationId: string, from: Date, to: Date) {
  return prisma.$queryRaw<Array<{ day: Date; total: number }>>(Prisma.sql`
    SELECT date_trunc('day', "createdAt") AS day, SUM("totalTTC")::float8 AS total
    FROM "Sale"
    WHERE "organizationId" = ${organizationId}
      AND "createdAt" >= ${from} AND "createdAt" < ${to}
      AND status::text = ANY(${postedSaleStatuses})
    GROUP BY day
    ORDER BY day ASC
  `);
}

/**
 * Top-5 categories by revenue share over the window, computed in
 * PostgreSQL - SaleLine has no categoryId of its own (it's on the related
 * Product), so this needs a join Prisma's groupBy can't express against a
 * relation's field. grandTotal is a window-function SUM computed BEFORE the
 * LIMIT 5 cut, so the revenue-share percentage below is still relative to
 * every category's total, exactly like the old JS version - not just the
 * top 5's own total.
 */
async function getCategoryRevenueShare(organizationId: string, from: Date, to: Date) {
  return prisma.$queryRaw<Array<{ category: string; revenue: number; grandTotal: number }>>(Prisma.sql`
    SELECT c.name AS category,
           SUM(sl."totalTTC")::float8 AS revenue,
           SUM(SUM(sl."totalTTC")) OVER ()::float8 AS "grandTotal"
    FROM "SaleLine" sl
    JOIN "Sale" s ON sl."saleId" = s.id
    JOIN "Product" p ON sl."productId" = p.id
    JOIN "Category" c ON p."categoryId" = c.id
    WHERE s."organizationId" = ${organizationId}
      AND s."createdAt" >= ${from} AND s."createdAt" < ${to}
      AND s.status::text = ANY(${postedSaleStatuses})
    GROUP BY c.name
    ORDER BY revenue DESC
    LIMIT 5
  `);
}

/**
 * Phase 3: dashboard-only stock snapshot - replaces the dashboard's use of
 * getStockSummary()/getStockLevels() (lib/server/stock-levels.ts), which
 * together loaded the ENTIRE StockLevel table (with Product/Category/Brand/
 * Supplier/StockLocation joins) TWICE just to reduce()/filter() a handful
 * of numbers in JS. getStockSummary/getStockLevels themselves are left
 * completely untouched (the /stock admin page still needs the full,
 * per-row list) - this is new, dashboard-specific, DB-aggregated
 * infrastructure. stockValue = salePrice * quantity and the OUT_OF_STOCK/
 * LOW_STOCK thresholds are copied verbatim from stock-levels.ts's
 * mapStockLevelToDto, so the numbers match exactly - see the Phase 3
 * report's non-regression comparison.
 */
async function getDashboardStockSnapshot(organizationId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ totalValue: number; productCount: number; outOfStockCount: number; lowStockCount: number }>
  >(Prisma.sql`
    SELECT
      COALESCE(SUM(sl.quantity * p."salePrice"), 0)::float8 AS "totalValue",
      COUNT(DISTINCT sl."productId")::int AS "productCount",
      COUNT(*) FILTER (WHERE (sl.quantity - sl."reservedQuantity") = 0)::int AS "outOfStockCount",
      COUNT(*) FILTER (
        WHERE (sl.quantity - sl."reservedQuantity") > 0
          AND (sl.quantity - sl."reservedQuantity") <= p."minimumStock"
      )::int AS "lowStockCount"
    FROM "StockLevel" sl
    JOIN "Product" p ON sl."productId" = p.id
    WHERE sl."organizationId" = ${organizationId}
  `);
  return rows[0] ?? { totalValue: 0, productCount: 0, outOfStockCount: 0, lowStockCount: 0 };
}

/**
 * Top-5 lowest-stock rows for the dashboard's alert list, computed in
 * PostgreSQL - same filter (minimumStock > 0 AND available <= minimumStock)
 * and same ordering (out-of-stock first, then ascending available
 * quantity) as the old JS .filter().sort().slice(5), just applied before
 * the rows ever leave the database instead of after loading every
 * StockLevel row in the organization.
 */
async function getDashboardStockAlerts(organizationId: string) {
  return prisma.$queryRaw<
    Array<{ id: string; productName: string; productReference: string; availableQuantity: number; minimumStock: number }>
  >(Prisma.sql`
    SELECT sl.id,
           p.name AS "productName",
           p.reference AS "productReference",
           (sl.quantity - sl."reservedQuantity")::int AS "availableQuantity",
           p."minimumStock"::int AS "minimumStock"
    FROM "StockLevel" sl
    JOIN "Product" p ON sl."productId" = p.id
    JOIN "StockLocation" loc ON sl."locationId" = loc.id
    WHERE sl."organizationId" = ${organizationId}
      AND p."minimumStock" > 0
      AND (sl.quantity - sl."reservedQuantity") <= p."minimumStock"
    ORDER BY
      CASE WHEN (sl.quantity - sl."reservedQuantity") = 0 THEN 0 ELSE 1 END ASC,
      (sl.quantity - sl."reservedQuantity") ASC,
      -- Same tie-break as the old getStockLevels()-based JS sort, which was
      -- stable over its own [{location.code asc},{product.name asc}]
      -- ordering - replicated here so which 5 rows win a tie exactly
      -- matches the old behavior (see the Phase 3 report's non-regression
      -- comparison).
      loc.code ASC,
      p.name ASC
    LIMIT 5
  `);
}

function buildTrend(
  current: number,
  previous: number,
  options?: { suffix?: string },
): DashboardMetric["trend"] {
  if (current === 0 && previous === 0) {
    return { value: `Stable${options?.suffix ?? ""}`, direction: "neutral" };
  }

  if (previous === 0) {
    return { value: `+100%${options?.suffix ?? ""}`, direction: "up" };
  }

  const delta = roundTo2(((current - previous) / previous) * 100);
  if (delta === 0) {
    return { value: `Stable${options?.suffix ?? ""}`, direction: "neutral" };
  }

  return {
    value: `${delta > 0 ? "+" : ""}${delta.toLocaleString("fr-FR")} %${options?.suffix ?? ""}`,
    direction: delta > 0 ? "up" : "down",
  };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
}

// F8-C: delegates to the shared decimal-based engine (lib/money.ts). Used
// here for both revenue amounts and percentage shares (category-revenue
// share, period-over-period delta) - unlike GPS/distance metrics
// (driver-tour.ts's roundMetric, deliberately left untouched), a
// percentage legitimately wants the exact same 2-decimal round-half-up
// rule as money, so reusing the money engine here does not lose any
// precision a percentage needs.
function roundTo2(value: number) {
  return roundMoney(value);
}

function formatMoney(value: number) {
  return `${value.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} DH`;
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
