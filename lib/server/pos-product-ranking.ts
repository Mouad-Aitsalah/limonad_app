import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";

/**
 * POS catalogue order: best sellers first.
 *
 * `rankPosProducts` returns an organisation's ACTIVE products ordered by TOTAL
 * QUANTITY SOLD (descending), with that quantity, computed by the database in
 * ONE query (no query per product):
 *
 *   - quantity = SUM(SaleLine.quantity) over the REAL sales of the organisation
 *     (counter AND truck sales), see SOLD_SALE_STATUSES;
 *   - a product that never sold has a quantity of 0 and comes after every sold
 *     product - it is never excluded (stock zero / negative is never a filter);
 *   - ties: designation (name), then reference, then id - a total, stable order
 *     (same collation as the previous `orderBy: { name: "asc" }`);
 *   - an optional `search` keeps the usual POS match (designation, reference or
 *     barcode contains the text, case-insensitive) and ranks only those products.
 *
 * `soldQuantitiesByProduct` gives the same quantity for an explicit list of
 * products (one query), used for the catalogue pages the offline POS downloads.
 *
 * Both only READ: prices, stock, invoices, payments and accounting are
 * untouched. Credit notes are not netted (it is the quantity SOLD, like the BI
 * and the forecasting, which use the same perimeter). The quantity is sent to
 * the POS only to sort the grid locally (also offline); it is never displayed.
 */

/**
 * Sale statuses that count as a real sale - the project-wide perimeter
 * (lib/server/dashboard-bi.ts REAL_SALE_STATUSES, lib/forecasting/product-
 * daily-sales.ts): DRAFT (prepared, not collected) and CANCELLED are excluded.
 * Sale has no soft-delete column; a cancelled sale keeps its row, hence the
 * status filter.
 */
export const SOLD_SALE_STATUSES = ["VALIDATED", "PARTIALLY_PAID", "PAID", "CREDIT", "CREDIT_NOTED"] as const;

type RankingDb = Pick<PrismaClient, "$queryRaw">;

export type RankedProduct = { id: string; quantity: number };

export async function rankPosProducts(
  db: RankingDb,
  params: { organizationId: string; search?: string | null; limit: number },
): Promise<RankedProduct[]> {
  const { organizationId } = params;
  const limit = Math.max(1, Math.trunc(params.limit));
  const search = params.search?.trim();
  const searchCondition = search
    ? Prisma.sql`AND (
        strpos(lower(p.name), lower(${search})) > 0
        OR strpos(lower(p.reference), lower(${search})) > 0
        OR strpos(lower(COALESCE(p.barcode, '')), lower(${search})) > 0
      )`
    : Prisma.empty;

  const rows = await db.$queryRaw<Array<{ id: string; quantity: bigint | number }>>(Prisma.sql`
    WITH matched AS (
      SELECT p.id, p.name, p.reference
      FROM "Product" p
      WHERE p."organizationId" = ${organizationId}
        AND p.status::text = 'ACTIVE'
        ${searchCondition}
    ),
    sold AS (
      SELECT sl."productId" AS id, SUM(sl.quantity)::bigint AS quantity
      FROM "SaleLine" sl
      JOIN "Sale" s ON s.id = sl."saleId"
      WHERE s."organizationId" = ${organizationId}
        AND s.status::text = ANY(${[...SOLD_SALE_STATUSES]})
        AND sl."productId" IN (SELECT id FROM matched)
      GROUP BY sl."productId"
    )
    SELECT m.id, COALESCE(sold.quantity, 0)::bigint AS quantity
    FROM matched m
    LEFT JOIN sold ON sold.id = m.id
    ORDER BY COALESCE(sold.quantity, 0) DESC, m.name ASC, m.reference ASC, m.id ASC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({ id: row.id, quantity: Number(row.quantity) }));
}

/** Total quantity sold of each given product (0 for a product with no real sale). One query. */
export async function soldQuantitiesByProduct(
  db: RankingDb,
  params: { organizationId: string; productIds: string[] },
): Promise<Map<string, number>> {
  const quantities = new Map<string, number>(params.productIds.map((id) => [id, 0]));
  if (params.productIds.length === 0) return quantities;
  const rows = await db.$queryRaw<Array<{ id: string; quantity: bigint | number }>>(Prisma.sql`
    SELECT sl."productId" AS id, SUM(sl.quantity)::bigint AS quantity
    FROM "SaleLine" sl
    JOIN "Sale" s ON s.id = sl."saleId"
    WHERE s."organizationId" = ${params.organizationId}
      AND s.status::text = ANY(${[...SOLD_SALE_STATUSES]})
      AND sl."productId" = ANY(${params.productIds})
    GROUP BY sl."productId"
  `);
  for (const row of rows) quantities.set(row.id, Number(row.quantity));
  return quantities;
}

/** Puts `rows` (fetched with `id IN (...)`, any order) back in the order of `orderedIds`. */
export function orderByIds<T extends { id: string }>(rows: T[], orderedIds: string[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: T[] = [];
  for (const id of orderedIds) {
    const row = byId.get(id);
    if (row) ordered.push(row);
  }
  return ordered;
}
