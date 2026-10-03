import { BUSINESS_DAY_TIME_ZONE, businessDayRangeUtc, getCurrentBusinessDayParam, isValidBusinessDayParam } from "@/lib/business-day";
import { Prisma } from "@/lib/generated/prisma/client";
import type { SaleStatus } from "@/lib/generated/prisma/client";

import { densifyProductDailySales, type ProductDailySalesRow } from "./daily-sales-series";

/**
 * Forecasting data layer, step 1: historical demand per Produit x Jour.
 *
 * Rules, all taken from the existing code (nothing invented here):
 *  - Which sales count: the same "real sales" perimeter as the BI helpers
 *    (lib/server/dashboard-bi.ts): VALIDATED, PARTIALLY_PAID, PAID, CREDIT,
 *    CREDIT_NOTED. DRAFT and CANCELLED are excluded.
 *  - Which date: Sale.soldAt when set (the real moment of an offline driver
 *    sale), otherwise Sale.validatedAt (what the BI helpers use).
 *  - Which day: the COMDIS business day (02:00 -> 02:00 in Africa/Casablanca,
 *    lib/business-day.ts), so a sale at 01:30 belongs to the previous day.
 *  - Quantity: SUM(SaleLine.quantity) per product and day, GROSS: customer
 *    returns (credit notes) are NOT subtracted - this is the demand that was
 *    actually served. Returns are reported separately by
 *    getProductDailySalesCoverage().
 *  - Scoping: always by organizationId, on the sale AND on the product.
 *
 * One aggregated SQL query for the whole history (no per-product / per-day
 * query). This module is framework-free (no server-only): the auth-scoped
 * entry point lives in lib/server/product-daily-sales.ts.
 */

export const REAL_SALE_STATUSES = [
  "VALIDATED",
  "PARTIALLY_PAID",
  "PAID",
  "CREDIT",
  "CREDIT_NOTED",
] satisfies SaleStatus[];

/** What the queries need: satisfied by PrismaClient and by a transaction client. */
export type ForecastDb = Pick<Prisma.TransactionClient, "$queryRaw" | "product" | "purchaseForecastSnapshot">;

export type ProductDailySalesOptions = {
  /** First business day, "YYYY-MM-DD". Default: from the beginning of history. */
  from?: string;
  /** Last business day, "YYYY-MM-DD". Default: last day with a sale. */
  to?: string;
  /**
   * false (default): only the days with a sale (sparse).
   * true: complete Produit x Jour series, zeros included, starting at each
   * product's existence.
   */
  complete?: boolean;
  /** Complete series only: also include products that never sold. Default false. */
  includeProductsWithoutSales?: boolean;
};

function assertDay(value: string | undefined, label: string) {
  if (value !== undefined && !isValidBusinessDayParam(value)) {
    throw new Error(`${label} doit être une date "YYYY-MM-DD".`);
  }
}

/** Sparse rows: only Produit x Jour pairs that really have sales. */
export async function queryProductDailySalesRows(
  db: ForecastDb,
  organizationId: string,
  options: Pick<ProductDailySalesOptions, "from" | "to"> = {},
): Promise<ProductDailySalesRow[]> {
  assertDay(options.from, "from");
  assertDay(options.to, "to");
  // Prisma DateTime columns are `timestamp` WITHOUT time zone holding UTC, so
  // the sale instant is read as UTC first, then converted to Casablanca local
  // time. The bounds are plain UTC instants, compared like dashboard-bi.ts does.
  const saleInstant = Prisma.sql`COALESCE(s."soldAt", s."validatedAt")`;
  const fromFilter = options.from
    ? Prisma.sql`AND ${saleInstant} >= ${businessDayRangeUtc(options.from).start}`
    : Prisma.empty;
  const toFilter = options.to
    ? Prisma.sql`AND ${saleInstant} < ${businessDayRangeUtc(options.to).end}`
    : Prisma.empty;

  const rows = await db.$queryRaw<Array<{ day: string; productId: string; productName: string; quantity: number }>>(Prisma.sql`
    SELECT to_char(
             (((${saleInstant}) AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_DAY_TIME_ZONE} - interval '2 hours')::date,
             'YYYY-MM-DD'
           ) AS day,
           p.id AS "productId",
           p.name AS "productName",
           SUM(sl.quantity)::int AS quantity
    FROM "SaleLine" sl
    JOIN "Sale" s ON s.id = sl."saleId"
    JOIN "Product" p ON p.id = sl."productId"
    WHERE s."organizationId" = ${organizationId}
      AND p."organizationId" = ${organizationId}
      AND s.status::text = ANY(${REAL_SALE_STATUSES})
      AND s."validatedAt" IS NOT NULL
      ${fromFilter}
      ${toFilter}
    GROUP BY 1, p.id, p.name
    ORDER BY 1, p.name, p.id
  `);

  return rows.map((row) => ({
    date: row.day,
    productId: row.productId,
    productName: row.productName,
    quantitySold: Number(row.quantity),
  }));
}

/**
 * Last business day with a real sale, per product ("YYYY-MM-DD"), up to and
 * including `to`. One aggregated, read-only query (same sale perimeter, same
 * date rule and same business day as queryProductDailySalesRows). Products
 * that never sold are absent from the map.
 */
export async function queryLastSaleDayByProduct(
  db: ForecastDb,
  organizationId: string,
  to: string,
): Promise<Map<string, string>> {
  assertDay(to, "to");
  const saleInstant = Prisma.sql`COALESCE(s."soldAt", s."validatedAt")`;
  const rows = await db.$queryRaw<Array<{ productId: string; day: string }>>(Prisma.sql`
    SELECT sl."productId" AS "productId",
           to_char(
             (((MAX(${saleInstant})) AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_DAY_TIME_ZONE} - interval '2 hours')::date,
             'YYYY-MM-DD'
           ) AS day
    FROM "SaleLine" sl
    JOIN "Sale" s ON s.id = sl."saleId"
    JOIN "Product" p ON p.id = sl."productId"
    WHERE s."organizationId" = ${organizationId}
      AND p."organizationId" = ${organizationId}
      AND s.status::text = ANY(${REAL_SALE_STATUSES})
      AND s."validatedAt" IS NOT NULL
      AND ${saleInstant} < ${businessDayRangeUtc(to).end}
    GROUP BY sl."productId"
  `);
  return new Map(rows.map((row) => [row.productId, row.day]));
}

/** Dataset for one organisation: sparse or complete Produit x Jour series. */
export async function buildProductDailySalesDataset(
  db: ForecastDb,
  organizationId: string,
  options: ProductDailySalesOptions = {},
): Promise<ProductDailySalesRow[]> {
  const rows = await queryProductDailySalesRows(db, organizationId, options);
  if (!options.complete) return rows;

  const lastSaleDay = rows.reduce((max, row) => (row.date > max ? row.date : max), "");
  const to = options.to ?? (lastSaleDay || getCurrentBusinessDayParam());

  const products = await db.product.findMany({
    where: { organizationId },
    select: { id: true, name: true, createdAt: true },
  });
  const soldIds = new Set(rows.map((row) => row.productId));
  const lifetimes = products
    .filter((product) => options.includeProductsWithoutSales || soldIds.has(product.id))
    .map((product) => ({
      productId: product.id,
      productName: product.name,
      createdDay: getCurrentBusinessDayParam(product.createdAt),
    }));

  const dense = densifyProductDailySales({ rows, products: lifetimes, to });
  // `from` trims the start of every series (a product may exist earlier).
  return options.from ? dense.filter((row) => row.date >= options.from!) : dense;
}

export type ProductDailySalesCoverage = {
  minDate: string | null;
  maxDate: string | null;
  salesCount: number;
  productCount: number;
  /** Distinct business days with at least one sale. */
  dayCount: number;
  /** Product x day pairs with sales (= sparse row count). */
  productDayRows: number;
  soldQuantity: number;
  /** Quantity on VALIDATED customer credit notes: NOT subtracted from the demand. */
  returnedQuantity: number;
};

export async function getProductDailySalesCoverage(
  db: ForecastDb,
  organizationId: string,
): Promise<ProductDailySalesCoverage> {
  const rows = await queryProductDailySalesRows(db, organizationId);
  const [{ salesCount }] = await db.$queryRaw<Array<{ salesCount: number }>>(Prisma.sql`
    SELECT COUNT(DISTINCT s.id)::int AS "salesCount"
    FROM "Sale" s
    JOIN "SaleLine" sl ON sl."saleId" = s.id
    WHERE s."organizationId" = ${organizationId}
      AND s.status::text = ANY(${REAL_SALE_STATUSES})
      AND s."validatedAt" IS NOT NULL
  `);
  const [{ returned }] = await db.$queryRaw<Array<{ returned: number }>>(Prisma.sql`
    SELECT COALESCE(SUM(cnl.quantity), 0)::int AS returned
    FROM "CreditNoteLine" cnl
    JOIN "CreditNote" cn ON cn.id = cnl."creditNoteId"
    WHERE cn."organizationId" = ${organizationId}
      AND cn."partyType"::text = 'CUSTOMER'
      AND cn.status::text = 'VALIDATED'
  `);
  const days = rows.map((row) => row.date).sort();
  return {
    minDate: days[0] ?? null,
    maxDate: days[days.length - 1] ?? null,
    salesCount: Number(salesCount),
    productCount: new Set(rows.map((row) => row.productId)).size,
    dayCount: new Set(days).size,
    productDayRows: rows.length,
    soldQuantity: rows.reduce((sum, row) => sum + row.quantitySold, 0),
    returnedQuantity: Number(returned),
  };
}
