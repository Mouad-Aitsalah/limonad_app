import { Prisma } from "@/lib/generated/prisma/client";
import { buildCustomerRows, summarize, type PortfolioCustomer, type WeekPurchase } from "@/lib/commercial-analysis/coverage";
import { AnalysisFilterError } from "@/lib/commercial-analysis/filters";
import { currentWeekParam, monthLabel, monthRange, weekRange } from "@/lib/commercial-analysis/period";
import {
  buildProductRows,
  buildTotals,
  buildUserRows,
  SALES_TABLE_ROW_CAP,
  sortProductRows,
  sortUserRows,
  type ProductMeta,
  type SalesAggregateRow,
} from "@/lib/commercial-analysis/sales-analysis";
import { roundMoney } from "@/lib/money";
import { SOLD_SALE_STATUSES } from "@/lib/server/pos-product-ranking";
import {
  NO_SUPPLIER,
  UNASSIGNED,
  type AnalysisUserOption,
  type CoverageDto,
  type CoverageFilters,
  type CoverageSummary,
  type CoverageUserRow,
  type SalesAnalysisDto,
  type SalesAnalysisFilters,
} from "@/types/commercial-analysis";

/**
 * Commercial analysis of the Dashboard: « Analyse des ventes » (by seller /
 * product / supplier) and « Couverture commerciale » (weekly).
 *
 * The cores below take the database client and the organisation as PARAMETERS: they
 * never decide who may call them - lib/server/commercial-analysis.ts does (ADMIN ONLY,
 * requireOrganizationUser(["admin"])) and passes the session's organisation. Everything is scoped to the caller's own organisation
 * (organizationId comes from the session, every table of every query is
 * filtered on it) and READ ONLY: nothing is written. The rules (what counts as
 * a sale, who its seller is, how returns and the margin are computed, how the portfolio
 * is defined) are documented in lib/commercial-analysis/sales-analysis.ts and
 * coverage.ts. The figures are aggregated by the database (grouped queries),
 * never computed from rows loaded one by one.
 */

const invalid = (message: string, field: string) => new AnalysisFilterError(message, field);

/** The database client the analyses run on: the real client, or a transaction (tests roll one back). */
export type AnalysisDb = Prisma.TransactionClient;

type OrgUser = AnalysisUserOption & { driverId: string | null; driverActive: boolean };

/** Every user of the organisation (the « Utilisateur » filters), with their driver profile when they have one. */
async function listUsers(db: AnalysisDb, organizationId: string): Promise<OrgUser[]> {
  const rows = await db.user.findMany({
    where: { organizationId },
    select: { id: true, fullName: true, email: true, driverProfile: { select: { id: true, active: true } } },
  });
  return rows
    .map((row) => ({
      id: row.id,
      name: row.fullName?.trim() || row.email,
      isDriver: Boolean(row.driverProfile),
      driverId: row.driverProfile?.id ?? null,
      driverActive: Boolean(row.driverProfile?.active),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

const toOption = ({ id, name, isDriver }: OrgUser): AnalysisUserOption => ({ id, name, isDriver });

/** Every id of a selection must exist in the caller's organisation (never a silent partial filter). */
function assertKnown(selected: readonly string[], known: ReadonlySet<string>, field: string, message: string) {
  for (const id of selected) if (!known.has(id)) throw invalid(message, field);
}

/** The seller of a sale `s` (with `sd` = its driver): the driver's user, else the user who recorded it. */
const SALE_SELLER = Prisma.sql`COALESCE(sd."userId", s."createdByUserId")`;

// ---------------------------------------------------------------------------
// Analyse des ventes
// ---------------------------------------------------------------------------

type RawSalesRow = {
  userId: string;
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

/** Products of the selected suppliers and/or without a supplier - one supplier per product, so no duplicate. */
function supplierCondition(supplierIds: readonly string[]): Prisma.Sql {
  if (supplierIds.length === 0) return Prisma.empty;
  const ids = supplierIds.filter((id) => id !== NO_SUPPLIER);
  const withoutSupplier = supplierIds.includes(NO_SUPPLIER);
  if (ids.length && withoutSupplier) return Prisma.sql`AND (p."defaultSupplierId" = ANY(${ids}) OR p."defaultSupplierId" IS NULL)`;
  if (withoutSupplier) return Prisma.sql`AND p."defaultSupplierId" IS NULL`;
  return Prisma.sql`AND p."defaultSupplierId" = ANY(${ids})`;
}

/** The analysis itself, for ONE organisation (the caller has been authorised and scoped by getSalesAnalysis). */
export async function loadSalesAnalysis(
  db: AnalysisDb,
  organizationId: string,
  filters: SalesAnalysisFilters,
): Promise<SalesAnalysisDto> {
  const [users, supplierRows, productsWithoutSupplier] = await Promise.all([
    listUsers(db, organizationId),
    db.supplier.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.product.count({ where: { organizationId, defaultSupplierId: null } }),
  ]);
  assertKnown(filters.userIds, new Set(users.map((user) => user.id)), "userIds", "Utilisateur introuvable.");
  assertKnown(
    filters.supplierIds.filter((id) => id !== NO_SUPPLIER),
    new Set(supplierRows.map((supplier) => supplier.id)),
    "supplierIds",
    "Fournisseur introuvable.",
  );

  const range = monthRange(filters.month);
  const suppliers = supplierCondition(filters.supplierIds);
  const statuses = [...SOLD_SALE_STATUSES];

  // ONE grouped query: the sold side (real sales of the month) and the returned side (validated customer
  // credit notes of the month) per SELLER x product. Seller of a sale: its driver's user, else the user who
  // recorded it; of a return: the seller of the original sale, else the credit note's driver, else the user
  // who recorded the credit note. Every sale / return has exactly one seller. All tables are filtered on the
  // organisation; the user selection is applied on these groups (lib/commercial-analysis/sales-analysis.ts).
  const rows = await db.$queryRaw<RawSalesRow[]>(Prisma.sql`
    WITH sold AS (
      SELECT ${SALE_SELLER} AS "userId", sl."productId" AS "productId",
             SUM(sl.quantity)::float8 AS quantity,
             SUM(sl."totalHT")::float8 AS revenue,
             SUM(sl.quantity * sl."unitCostHT")::float8 AS cost
      FROM "SaleLine" sl
      JOIN "Sale" s ON s.id = sl."saleId"
      JOIN "Product" p ON p.id = sl."productId"
      LEFT JOIN "Driver" sd ON sd.id = s."driverId" AND sd."organizationId" = ${organizationId}
      WHERE s."organizationId" = ${organizationId}
        AND p."organizationId" = ${organizationId}
        AND s.status::text = ANY(${statuses})
        AND s."validatedAt" >= ${range.start} AND s."validatedAt" < ${range.end}
        ${suppliers}
      GROUP BY 1, sl."productId"
    ),
    returned AS (
      SELECT COALESCE(osd."userId", os."createdByUserId", cnd."userId", cn."createdByUserId") AS "userId",
             cl."productId" AS "productId",
             SUM(cl.quantity)::float8 AS quantity,
             SUM(cl."totalHT")::float8 AS revenue,
             SUM(CASE WHEN sl.id IS NOT NULL THEN cl.quantity * sl."unitCostHT" ELSE 0 END)::float8 AS cost,
             COUNT(*) FILTER (WHERE sl.id IS NULL)::float8 AS "linesWithoutCost"
      FROM "CreditNoteLine" cl
      JOIN "CreditNote" cn ON cn.id = cl."creditNoteId"
      JOIN "Product" p ON p.id = cl."productId"
      LEFT JOIN "Sale" os ON os.id = cn."originalSaleId" AND os."organizationId" = ${organizationId}
      LEFT JOIN "Driver" osd ON osd.id = os."driverId" AND osd."organizationId" = ${organizationId}
      LEFT JOIN "Driver" cnd ON cnd.id = cn."driverId" AND cnd."organizationId" = ${organizationId}
      LEFT JOIN "SaleLine" sl ON sl.id = cl."saleLineId"
      WHERE cn."organizationId" = ${organizationId}
        AND p."organizationId" = ${organizationId}
        AND cn."partyType"::text = 'CUSTOMER'
        AND cn.status::text = 'VALIDATED'
        AND cn."validatedAt" >= ${range.start} AND cn."validatedAt" < ${range.end}
        ${suppliers}
      GROUP BY 1, cl."productId"
    )
    SELECT COALESCE(sold."userId", returned."userId") AS "userId",
           COALESCE(sold."productId", returned."productId") AS "productId",
           pr.name AS name, pr.reference AS reference,
           pr."defaultSupplierId" AS "supplierId", su.name AS "supplierName",
           sold.quantity AS "soldQuantity", sold.revenue AS "soldRevenue", sold.cost AS "soldCost",
           returned.quantity AS "returnedQuantity", returned.revenue AS "returnedRevenue", returned.cost AS "returnedCost",
           returned."linesWithoutCost" AS "returnLinesWithoutCost"
    FROM sold
    FULL OUTER JOIN returned ON returned."userId" = sold."userId" AND returned."productId" = sold."productId"
    JOIN "Product" pr ON pr.id = COALESCE(sold."productId", returned."productId")
    LEFT JOIN "Supplier" su ON su.id = pr."defaultSupplierId"
  `);

  const aggregates: SalesAggregateRow[] = rows.map((row) => ({
    userId: row.userId,
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

  const selection = { userIds: filters.userIds };
  const productRows = sortProductRows(buildProductRows(aggregates, meta, selection), filters.sort, filters.direction);
  const totals = buildTotals(aggregates, selection);
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const byUser = sortUserRows(buildUserRows(aggregates, userNames, selection), filters.sort, filters.direction);
  const selected = filters.userIds.length ? new Set(filters.userIds) : null;
  const returnLinesWithoutCost = aggregates
    .filter((row) => !selected || selected.has(row.userId))
    .reduce((sum, row) => sum + (row.returnLinesWithoutCost ?? 0), 0);

  // Truck sales of the month that carry NO driver (of the selected sellers): attributed to the user who recorded them.
  const unattributed = await db.sale.aggregate({
    where: {
      organizationId,
      origin: "TRUCK",
      driverId: null,
      status: { in: SOLD_SALE_STATUSES as unknown as Array<(typeof SOLD_SALE_STATUSES)[number]> },
      validatedAt: { gte: range.start, lt: range.end },
      ...(filters.userIds.length ? { createdByUserId: { in: filters.userIds } } : {}),
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
    byUser,
    users: users.map(toOption),
    suppliers: supplierRows,
    hasProductsWithoutSupplier: productsWithoutSupplier > 0,
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

const sumSummaries = (rows: readonly CoverageSummary[]) =>
  summarize(
    rows.reduce((sum, row) => sum + row.assigned, 0),
    rows.reduce((sum, row) => sum + row.buyers, 0),
  );

/** The coverage itself, for ONE organisation (the caller has been authorised and scoped by getCoverage). */
export async function loadCoverage(
  db: AnalysisDb,
  organizationId: string,
  filters: CoverageFilters,
): Promise<CoverageDto> {
  const users = await listUsers(db, organizationId);
  const selectedUserIds = filters.userIds.filter((id) => id !== UNASSIGNED);
  const unassignedSelected = filters.userIds.includes(UNASSIGNED);
  assertKnown(selectedUserIds, new Set(users.map((user) => user.id)), "userIds", "Utilisateur introuvable.");

  const range = weekRange(filters.week);
  const statuses = [...SOLD_SALE_STATUSES];
  const saleScope = Prisma.sql`s."organizationId" = ${organizationId}
        AND s.status::text = ANY(${statuses})
        AND s."validatedAt" >= ${range.start} AND s."validatedAt" < ${range.end}
        AND s."customerId" IS NOT NULL`;
  // a customer counts in a portfolio (or in « Non attribués ») when active and existing at the end of the week
  const customerInScope = Prisma.sql`c.status::text = 'ACTIVE' AND c."createdAt" < ${range.end}`;
  const isCurrentWeek = filters.week === currentWeekParam();
  const period = { fromDay: range.fromDay, toDay: range.toDay, isCurrentWeek };
  const hasSelection = filters.userIds.length > 0;
  const selectedSellers = selectedUserIds.length ? selectedUserIds : null;
  // only « Non attribués » selected: no seller, so nothing is « outside a seller's portfolio »
  const outsideApplies = !hasSelection || selectedSellers !== null;

  const [assignedRows, buyerRows, unassignedCount, unassignedBuyerRows, outside, sellersOfWeek] = await Promise.all([
    // portfolio size per owner (driver profile -> its user)
    db.customer.groupBy({
      by: ["createdByDriverId"],
      where: { organizationId, status: "ACTIVE", createdByDriverId: { not: null }, createdAt: { lt: range.end } },
      _count: { _all: true },
    }),
    // DISTINCT customers of each portfolio who bought from its owner: a customer buying three times counts once
    db.$queryRaw<Array<{ userId: string; buyers: number }>>(Prisma.sql`
      SELECT cd."userId" AS "userId", COUNT(DISTINCT s."customerId")::int AS buyers
      FROM "Sale" s
      JOIN "Customer" c ON c.id = s."customerId" AND c."organizationId" = ${organizationId}
      JOIN "Driver" cd ON cd.id = c."createdByDriverId" AND cd."organizationId" = ${organizationId}
      LEFT JOIN "Driver" sd ON sd.id = s."driverId" AND sd."organizationId" = ${organizationId}
      WHERE ${saleScope} AND ${customerInScope}
        AND ${SALE_SELLER} = cd."userId"
      GROUP BY cd."userId"
    `),
    db.customer.count({ where: { organizationId, status: "ACTIVE", createdByDriverId: null, createdAt: { lt: range.end } } }),
    // « Non attribués » who bought from anybody this week (distinct customers)
    db.$queryRaw<Array<{ buyers: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT s."customerId")::int AS buyers
      FROM "Sale" s
      JOIN "Customer" c ON c.id = s."customerId" AND c."organizationId" = ${organizationId}
      WHERE ${saleScope} AND ${customerInScope} AND c."createdByDriverId" IS NULL
    `),
    // customers served by the selected sellers (or anybody) OUTSIDE the seller's own portfolio - distinct over the union
    outsideApplies
      ? db.$queryRaw<Array<{ customers: number; sales: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT s."customerId")::int AS customers, COUNT(*)::int AS sales
      FROM "Sale" s
      LEFT JOIN "Customer" c ON c.id = s."customerId" AND c."organizationId" = ${organizationId}
      LEFT JOIN "Driver" cd ON cd.id = c."createdByDriverId" AND cd."organizationId" = ${organizationId}
      LEFT JOIN "Driver" sd ON sd.id = s."driverId" AND sd."organizationId" = ${organizationId}
      WHERE ${saleScope}
        ${selectedSellers ? Prisma.sql`AND ${SALE_SELLER} = ANY(${selectedSellers})` : Prisma.empty}
        AND (cd."userId" IS DISTINCT FROM ${SALE_SELLER} OR c.status::text <> 'ACTIVE' OR c."createdAt" >= ${range.end})
    `)
      : Promise.resolve([{ customers: 0, sales: 0 }]),
    // users who sold to a customer this week (so a non-driver seller appears in the comparison)
    db.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
      SELECT DISTINCT ${SALE_SELLER} AS "userId"
      FROM "Sale" s
      LEFT JOIN "Driver" sd ON sd.id = s."driverId" AND sd."organizationId" = ${organizationId}
      WHERE ${saleScope}
    `),
  ]);

  const userOfDriver = new Map(users.filter((user) => user.driverId).map((user) => [user.driverId as string, user]));
  const assignedByUser = new Map<string, number>();
  for (const row of assignedRows) {
    const owner = userOfDriver.get(row.createdByDriverId as string);
    if (owner) assignedByUser.set(owner.id, row._count._all);
  }
  const buyersByUser = new Map(buyerRows.map((row) => [row.userId, row.buyers]));
  const soldThisWeek = new Set(sellersOfWeek.map((row) => row.userId));
  const rowOf = (user: OrgUser): CoverageUserRow => ({
    userId: user.id,
    userName: user.name,
    ...summarize(assignedByUser.get(user.id) ?? 0, buyersByUser.get(user.id) ?? 0),
  });

  // The comparison: the selected users (none when only « Non attribués » is selected); with no selection,
  // every user with a portfolio, a sale this week, or an active driver profile.
  const shownUsers = hasSelection
    ? users.filter((user) => selectedUserIds.includes(user.id))
    : users.filter((user) => (assignedByUser.get(user.id) ?? 0) > 0 || soldThisWeek.has(user.id) || user.driverActive);
  const byUser = shownUsers.map(rowOf).sort((a, b) => a.userName.localeCompare(b.userName, "fr", { sensitivity: "base" }));

  const unassigned = summarize(unassignedCount, unassignedBuyerRows[0]?.buyers ?? 0);
  // Summary: the union of the selected portfolios (disjoint by construction) + « Non attribués » when selected;
  // with no selection, every user's portfolio - the « Non attribués » stay apart.
  const summary = sumSummaries([...byUser, ...(unassignedSelected ? [unassigned] : [])]);

  // The customers of the selected portfolios (only when something is selected).
  let customers: CoverageDto["customers"] = [];
  let customersTruncated = false;
  if (hasSelection) {
    const ownerDriverIds = users.filter((user) => selectedUserIds.includes(user.id) && user.driverId).map((user) => user.driverId as string);
    const portfolioWhere: Prisma.CustomerWhereInput = {
      organizationId,
      status: "ACTIVE",
      createdAt: { lt: range.end },
      OR: [
        ...(ownerDriverIds.length ? [{ createdByDriverId: { in: ownerDriverIds } }] : []),
        ...(unassignedSelected ? [{ createdByDriverId: null }] : []),
      ],
    };
    const portfolioRows =
      ownerDriverIds.length || unassignedSelected
        ? await db.customer.findMany({
            where: portfolioWhere,
            select: { id: true, name: true, createdByDriverId: true },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take: COVERAGE_CUSTOMER_CAP + 1,
          })
        : [];
    customersTruncated = portfolioRows.length > COVERAGE_CUSTOMER_CAP;
    const portfolio: PortfolioCustomer[] = portfolioRows.slice(0, COVERAGE_CUSTOMER_CAP).map((row) => ({
      customerId: row.id,
      name: row.name,
      ownerName: row.createdByDriverId ? (userOfDriver.get(row.createdByDriverId)?.name ?? null) : null,
    }));
    const ids = portfolio.map((customer) => customer.customerId);
    // purchases of the week: from the portfolio owner (the rate rule), from anybody for an unassigned customer
    const purchaseRows = ids.length
      ? await db.$queryRaw<Array<{ customerId: string; sales: number; amount: number; last: Date | null }>>(Prisma.sql`
          SELECT s."customerId" AS "customerId", COUNT(*)::int AS sales, SUM(s."totalTTC")::float8 AS amount, MAX(s."validatedAt") AS last
          FROM "Sale" s
          JOIN "Customer" c ON c.id = s."customerId" AND c."organizationId" = ${organizationId}
          LEFT JOIN "Driver" cd ON cd.id = c."createdByDriverId" AND cd."organizationId" = ${organizationId}
          LEFT JOIN "Driver" sd ON sd.id = s."driverId" AND sd."organizationId" = ${organizationId}
          WHERE ${saleScope}
            AND s."customerId" = ANY(${ids})
            AND (c."createdByDriverId" IS NULL OR cd."userId" = ${SALE_SELLER})
          GROUP BY s."customerId"
        `)
      : [];
    const purchases = new Map<string, WeekPurchase>(
      purchaseRows.map((row) => [row.customerId, { customerId: row.customerId, salesCount: row.sales, amount: row.amount ?? 0, lastPurchaseAt: row.last }]),
    );
    customers = buildCustomerRows(portfolio, purchases);
  }

  return {
    filters,
    period,
    summary,
    customers,
    customersTruncated,
    byUser,
    unassigned,
    users: users.map(toOption),
    outsidePortfolio: { customers: outside[0]?.customers ?? 0, sales: outside[0]?.sales ?? 0 },
  };
}
