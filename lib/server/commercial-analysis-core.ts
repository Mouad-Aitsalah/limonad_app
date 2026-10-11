import { Prisma } from "@/lib/generated/prisma/client";
import { buildCustomerRows, summarize, summarizeCustomerRows, type PortfolioCustomer, type WeekPurchase } from "@/lib/commercial-analysis/coverage";
import { AnalysisFilterError } from "@/lib/commercial-analysis/filters";
import { currentWeekParam, monthLabel, monthRange, weekRange } from "@/lib/commercial-analysis/period";
import {
  buildDriverRows,
  buildProductRows,
  buildTotals,
  SALES_TABLE_ROW_CAP,
  sortDriverRows,
  sortProductRows,
  type ProductMeta,
  type SalesAggregateRow,
} from "@/lib/commercial-analysis/sales-analysis";
import { roundMoney } from "@/lib/money";
import { SOLD_SALE_STATUSES } from "@/lib/server/pos-product-ranking";
import type {
  CoverageDriverRow,
  CoverageDto,
  CoverageFilters,
  SalesAnalysisDto,
  SalesAnalysisFilters,
} from "@/types/commercial-analysis";

/**
 * Commercial analysis of the Dashboard: « Analyse des ventes » (by driver /
 * product / supplier) and « Couverture commerciale » (weekly).
 *
 * The cores below take the database client and the organisation as PARAMETERS: they
 * never decide who may call them - lib/server/commercial-analysis.ts does (ADMIN ONLY,
 * requireOrganizationUser(["admin"])) and passes the session's organisation. Everything is scoped to the caller's own organisation
 * (organizationId comes from the session, every table of every query is
 * filtered on it) and READ ONLY: nothing is written. The rules (what counts as
 * a sale, how returns and the margin are computed, how the portfolio is
 * defined) are documented in lib/commercial-analysis/sales-analysis.ts and
 * coverage.ts. The figures are aggregated by the database (one grouped query
 * each), never computed from rows loaded one by one.
 */

const invalid = (message: string, field: string) => new AnalysisFilterError(message, field);

/** The database client the analyses run on: the real client, or a transaction (tests roll one back). */
export type AnalysisDb = Prisma.TransactionClient;

async function listDrivers(db: AnalysisDb, organizationId: string) {
  const rows = await db.driver.findMany({
    where: { organizationId },
    select: { id: true, active: true, user: { select: { fullName: true } } },
  });
  return rows
    .map((row) => ({ id: row.id, name: row.user.fullName, active: row.active }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

// ---------------------------------------------------------------------------
// Analyse des ventes
// ---------------------------------------------------------------------------

type RawSalesRow = {
  driverId: string;
  productId: string;
  name: string | null;
  reference: string | null;
  supplierId: string | null;
  supplierName: string | null;
  soldQuantity: number | null;
  soldRevenue: number | null;
  soldCost: number | null;
  returnedQuantity: number | null;
  returnedRevenue: number | null;
  returnedCost: number | null;
  returnLinesWithoutCost: number | null;
};

/** The analysis itself, for ONE organisation (the caller has been authorised and scoped by getSalesAnalysis). */
export async function loadSalesAnalysis(
  db: AnalysisDb,
  organizationId: string,
  filters: SalesAnalysisFilters,
): Promise<SalesAnalysisDto> {
  const [drivers, supplierRows] = await Promise.all([
    listDrivers(db, organizationId),
    db.supplier.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (filters.driverId !== "all" && !drivers.some((driver) => driver.id === filters.driverId)) {
    throw invalid("Chauffeur introuvable.", "driverId");
  }
  if (filters.supplierId !== "all" && filters.supplierId !== "none" && !supplierRows.some((supplier) => supplier.id === filters.supplierId)) {
    throw invalid("Fournisseur introuvable.", "supplierId");
  }

  const range = monthRange(filters.month);
  const supplierCondition =
    filters.supplierId === "all"
      ? Prisma.empty
      : filters.supplierId === "none"
        ? Prisma.sql`AND p."defaultSupplierId" IS NULL`
        : Prisma.sql`AND p."defaultSupplierId" = ${filters.supplierId}`;
  const statuses = [...SOLD_SALE_STATUSES];

  // ONE grouped query: the sold side (real sales of the month, a driver set) and the returned side
  // (validated customer credit notes of the month) per driver x product. The driver of a return is the
  // driver of the ORIGINAL sale (else the credit note's own driver); a sale / return with no driver is
  // never put on a driver. All tables are filtered on the organisation.
  const rows = await db.$queryRaw<RawSalesRow[]>(Prisma.sql`
    WITH sold AS (
      SELECT s."driverId" AS "driverId", sl."productId" AS "productId",
             SUM(sl.quantity)::float8 AS quantity,
             SUM(sl."totalHT")::float8 AS revenue,
             SUM(sl.quantity * sl."unitCostHT")::float8 AS cost
      FROM "SaleLine" sl
      JOIN "Sale" s ON s.id = sl."saleId"
      JOIN "Product" p ON p.id = sl."productId"
      WHERE s."organizationId" = ${organizationId}
        AND p."organizationId" = ${organizationId}
        AND s.status::text = ANY(${statuses})
        AND s."validatedAt" >= ${range.start} AND s."validatedAt" < ${range.end}
        AND s."driverId" IS NOT NULL
        ${supplierCondition}
      GROUP BY s."driverId", sl."productId"
    ),
    returned AS (
      SELECT COALESCE(os."driverId", cn."driverId") AS "driverId", cl."productId" AS "productId",
             SUM(cl.quantity)::float8 AS quantity,
             SUM(cl."totalHT")::float8 AS revenue,
             SUM(CASE WHEN sl.id IS NOT NULL THEN cl.quantity * sl."unitCostHT" ELSE 0 END)::float8 AS cost,
             COUNT(*) FILTER (WHERE sl.id IS NULL)::float8 AS "linesWithoutCost"
      FROM "CreditNoteLine" cl
      JOIN "CreditNote" cn ON cn.id = cl."creditNoteId"
      JOIN "Product" p ON p.id = cl."productId"
      LEFT JOIN "Sale" os ON os.id = cn."originalSaleId" AND os."organizationId" = ${organizationId}
      LEFT JOIN "SaleLine" sl ON sl.id = cl."saleLineId"
      WHERE cn."organizationId" = ${organizationId}
        AND p."organizationId" = ${organizationId}
        AND cn."partyType"::text = 'CUSTOMER'
        AND cn.status::text = 'VALIDATED'
        AND cn."validatedAt" >= ${range.start} AND cn."validatedAt" < ${range.end}
        AND COALESCE(os."driverId", cn."driverId") IS NOT NULL
        ${supplierCondition}
      GROUP BY COALESCE(os."driverId", cn."driverId"), cl."productId"
    )
    SELECT COALESCE(sold."driverId", returned."driverId") AS "driverId",
           COALESCE(sold."productId", returned."productId") AS "productId",
           pr.name AS name, pr.reference AS reference,
           pr."defaultSupplierId" AS "supplierId", su.name AS "supplierName",
           sold.quantity AS "soldQuantity", sold.revenue AS "soldRevenue", sold.cost AS "soldCost",
           returned.quantity AS "returnedQuantity", returned.revenue AS "returnedRevenue", returned.cost AS "returnedCost",
           returned."linesWithoutCost" AS "returnLinesWithoutCost"
    FROM sold
    FULL OUTER JOIN returned ON returned."driverId" = sold."driverId" AND returned."productId" = sold."productId"
    JOIN "Product" pr ON pr.id = COALESCE(sold."productId", returned."productId")
    LEFT JOIN "Supplier" su ON su.id = pr."defaultSupplierId"
  `);

  const aggregates: SalesAggregateRow[] = rows.map((row) => ({
    driverId: row.driverId,
    productId: row.productId,
    soldQuantity: row.soldQuantity ?? 0,
    soldRevenue: row.soldRevenue ?? 0,
    soldCost: row.soldCost ?? 0,
    returnedQuantity: row.returnedQuantity ?? 0,
    returnedRevenue: row.returnedRevenue ?? 0,
    returnedCost: row.returnedCost ?? 0,
    returnLinesWithoutCost: row.returnLinesWithoutCost ?? 0,
  }));
  const meta = new Map<string, ProductMeta>(
    rows.map((row) => [
      row.productId,
      { name: row.name ?? "", reference: row.reference ?? "", supplierId: row.supplierId, supplierName: row.supplierName },
    ]),
  );

  const selectedDriver = filters.driverId === "all" ? undefined : filters.driverId;
  const productRows = sortProductRows(buildProductRows(aggregates, meta, { driverId: selectedDriver }), filters.sort, filters.direction);
  const totals = buildTotals(aggregates, { driverId: selectedDriver });
  const driverNames = new Map(drivers.map((driver) => [driver.id, driver.name]));
  const byDriver =
    filters.driverId === "all"
      ? sortDriverRows(buildDriverRows(aggregates, driverNames), filters.sort, filters.direction)
      : null;
  const returnLinesWithoutCost = aggregates
    .filter((row) => !selectedDriver || row.driverId === selectedDriver)
    .reduce((sum, row) => sum + (row.returnLinesWithoutCost ?? 0), 0);

  // Truck sales of the month that carry NO driver: not in any driver's figures, reported instead of guessed.
  const unattributed = await db.sale.aggregate({
    where: {
      organizationId,
      origin: "TRUCK",
      driverId: null,
      status: { in: SOLD_SALE_STATUSES as unknown as Array<(typeof SOLD_SALE_STATUSES)[number]> },
      validatedAt: { gte: range.start, lt: range.end },
    },
    _count: { _all: true },
    _sum: { subtotalHT: true },
  });

  return {
    filters,
    period: { month: filters.month, label: monthLabel(filters.month), fromDay: range.fromDay, toDay: range.toDay },
    totals,
    products: productRows.slice(0, SALES_TABLE_ROW_CAP),
    productRowCount: productRows.length,
    truncated: productRows.length > SALES_TABLE_ROW_CAP,
    byDriver,
    drivers: drivers.map(({ id, name }) => ({ id, name })),
    suppliers: supplierRows,
    dataQuality: {
      truckSalesWithoutDriver: {
        count: unattributed._count._all,
        revenue: roundMoney(unattributed._sum.subtotalHT?.toNumber() ?? 0),
      },
      returnLinesWithoutCost,
    },
  };
}

// ---------------------------------------------------------------------------
// Couverture commerciale
// ---------------------------------------------------------------------------

const COVERAGE_CUSTOMER_CAP = 2000;

/** Portfolio rule (see lib/commercial-analysis/coverage.ts): active customers created by the driver, existing at the week's end. */
function portfolioWhere(organizationId: string, driverId: string, weekEnd: Date): Prisma.CustomerWhereInput {
  return { organizationId, status: "ACTIVE", createdByDriverId: driverId, createdAt: { lt: weekEnd } };
}

/** The coverage itself, for ONE organisation (the caller has been authorised and scoped by getCoverage). */
export async function loadCoverage(
  db: AnalysisDb,
  organizationId: string,
  filters: CoverageFilters,
): Promise<CoverageDto> {
  const drivers = await listDrivers(db, organizationId);
  if (filters.driverId !== "all" && !drivers.some((driver) => driver.id === filters.driverId)) {
    throw invalid("Chauffeur introuvable.", "driverId");
  }
  const range = weekRange(filters.week);
  const statuses = [...SOLD_SALE_STATUSES];
  const saleScope = Prisma.sql`s."organizationId" = ${organizationId}
        AND s.status::text = ANY(${statuses})
        AND s."validatedAt" >= ${range.start} AND s."validatedAt" < ${range.end}
        AND s."customerId" IS NOT NULL`;
  const isCurrentWeek = filters.week === currentWeekParam();
  const period = { fromDay: range.fromDay, toDay: range.toDay, isCurrentWeek };

  if (filters.driverId === "all") {
    const [assignedRows, buyerRows, outside] = await Promise.all([
      db.customer.groupBy({
        by: ["createdByDriverId"],
        where: { organizationId, status: "ACTIVE", createdByDriverId: { not: null }, createdAt: { lt: range.end } },
        _count: { _all: true },
      }),
      // DISTINCT customers per driver: a customer buying three times in the week counts once
      db.$queryRaw<Array<{ driverId: string; buyers: number }>>(Prisma.sql`
        SELECT s."driverId" AS "driverId", COUNT(DISTINCT s."customerId")::int AS buyers
        FROM "Sale" s
        JOIN "Customer" c ON c.id = s."customerId" AND c."organizationId" = ${organizationId}
        WHERE ${saleScope}
          AND s."driverId" IS NOT NULL
          AND c."createdByDriverId" = s."driverId" AND c.status::text = 'ACTIVE' AND c."createdAt" < ${range.end}
        GROUP BY s."driverId"
      `),
      db.$queryRaw<Array<{ customers: number; sales: number }>>(Prisma.sql`
        SELECT COUNT(DISTINCT s."customerId")::int AS customers, COUNT(*)::int AS sales
        FROM "Sale" s
        LEFT JOIN "Customer" c ON c.id = s."customerId" AND c."organizationId" = ${organizationId}
        WHERE ${saleScope}
          AND s."driverId" IS NOT NULL
          AND (c."createdByDriverId" IS DISTINCT FROM s."driverId" OR c.status::text <> 'ACTIVE' OR c."createdAt" >= ${range.end})
      `),
    ]);
    const assignedBy = new Map(assignedRows.map((row) => [row.createdByDriverId as string, row._count._all]));
    const buyersBy = new Map(buyerRows.map((row) => [row.driverId, row.buyers]));
    const byDriver: CoverageDriverRow[] = drivers
      .filter((driver) => driver.active || (assignedBy.get(driver.id) ?? 0) > 0)
      .map((driver) => ({
        driverId: driver.id,
        driverName: driver.name,
        ...summarize(assignedBy.get(driver.id) ?? 0, buyersBy.get(driver.id) ?? 0),
      }))
      .sort((a, b) => a.driverName.localeCompare(b.driverName, "fr", { sensitivity: "base" }));
    const totalAssigned = byDriver.reduce((sum, row) => sum + row.assigned, 0);
    const totalBuyers = byDriver.reduce((sum, row) => sum + row.buyers, 0);
    return {
      filters,
      period,
      summary: summarize(totalAssigned, totalBuyers),
      customers: [],
      customersTruncated: false,
      byDriver,
      drivers: drivers.map(({ id, name }) => ({ id, name })),
      outsidePortfolio: { customers: outside[0]?.customers ?? 0, sales: outside[0]?.sales ?? 0 },
    };
  }

  const driverId = filters.driverId;
  const [portfolioRows, purchaseRows] = await Promise.all([
    db.customer.findMany({
      where: portfolioWhere(organizationId, driverId, range.end),
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: COVERAGE_CUSTOMER_CAP + 1,
    }),
    db.sale.groupBy({
      by: ["customerId"],
      where: {
        organizationId,
        driverId,
        customerId: { not: null },
        status: { in: statuses as unknown as Array<(typeof SOLD_SALE_STATUSES)[number]> },
        validatedAt: { gte: range.start, lt: range.end },
      },
      _count: { _all: true },
      _sum: { totalTTC: true },
      _max: { validatedAt: true },
    }),
  ]);
  const customersTruncated = portfolioRows.length > COVERAGE_CUSTOMER_CAP;
  const portfolio: PortfolioCustomer[] = portfolioRows
    .slice(0, COVERAGE_CUSTOMER_CAP)
    .map((row) => ({ customerId: row.id, name: row.name }));
  const purchases = new Map<string, WeekPurchase>(
    purchaseRows.map((row) => [
      row.customerId as string,
      {
        customerId: row.customerId as string,
        salesCount: row._count._all,
        amount: row._sum.totalTTC?.toNumber() ?? 0,
        lastPurchaseAt: row._max.validatedAt,
      },
    ]),
  );
  const customers = buildCustomerRows(portfolio, purchases);
  const inPortfolio = new Set(portfolio.map((customer) => customer.customerId));
  const outsideRows = purchaseRows.filter((row) => !inPortfolio.has(row.customerId as string));

  // The rate is computed on the WHOLE portfolio, even when the table is capped.
  const summary = customersTruncated
    ? summarize(
        await db.customer.count({ where: portfolioWhere(organizationId, driverId, range.end) }),
        customers.filter((row) => row.status === "BOUGHT").length,
      )
    : summarizeCustomerRows(customers);

  return {
    filters,
    period,
    summary,
    customers,
    customersTruncated,
    byDriver: null,
    drivers: drivers.map(({ id, name }) => ({ id, name })),
    outsidePortfolio: {
      customers: outsideRows.length,
      sales: outsideRows.reduce((sum, row) => sum + row._count._all, 0),
    },
  };
}
