import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { PurchaseStatus, SaleStatus } from "@/lib/generated/prisma/client";
import { roundMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { totalValidatedExpensesHT } from "@/lib/server/expenses";
import { totalCustomerReceivables } from "@/lib/server/customer-settlements";

/**
 * BI Phase 2A - reliable KPI helpers for the future Dashboard Direction.
 * NOT wired to /dashboard yet (Phase 2B, by decision) - getDashboardData()
 * in lib/server/dashboard.ts is untouched.
 *
 * Common perimeter for every "ventes" helper (see the Phase 1 audit):
 *   include VALIDATED, PARTIALLY_PAID, PAID, CREDIT, CREDIT_NOTED
 *   exclude DRAFT, CANCELLED
 *   date field: Sale.validatedAt (100% coverage on real sales - NULL only
 *   on DRAFT/CANCELLED, so this filter alone already excludes them without
 *   needing the status list too, but both are kept for clarity/defence in
 *   depth).
 */
const REAL_SALE_STATUSES = [
  "VALIDATED",
  "PARTIALLY_PAID",
  "PAID",
  "CREDIT",
  "CREDIT_NOTED",
] satisfies SaleStatus[];

const REAL_PURCHASE_STATUSES = ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"] satisfies PurchaseStatus[];

export type BiPeriod = { from: Date; to: Date };

/** CA TTC + HT over the period. */
export async function revenue(
  organizationId: string,
  period: BiPeriod,
): Promise<{ ttc: number; ht: number }> {
  const agg = await prisma.sale.aggregate({
    where: {
      organizationId,
      status: { in: REAL_SALE_STATUSES },
      validatedAt: { gte: period.from, lt: period.to },
    },
    _sum: { totalTTC: true, subtotalHT: true },
  });
  return {
    ttc: roundMoney(agg._sum.totalTTC?.toNumber() ?? 0),
    ht: roundMoney(agg._sum.subtotalHT?.toNumber() ?? 0),
  };
}

/** Nombre de ventes reelles validees sur la periode. */
export async function salesCount(organizationId: string, period: BiPeriod): Promise<number> {
  return prisma.sale.count({
    where: {
      organizationId,
      status: { in: REAL_SALE_STATUSES },
      validatedAt: { gte: period.from, lt: period.to },
    },
  });
}

/** CA TTC / nombre de ventes ; 0 si aucune vente. */
export async function avgBasket(organizationId: string, period: BiPeriod): Promise<number> {
  const [{ ttc }, count] = await Promise.all([
    revenue(organizationId, period),
    salesCount(organizationId, period),
  ]);
  return count > 0 ? roundMoney(ttc / count) : 0;
}

/**
 * Marge brute HT = SUM(SaleLine.totalHT - quantity * unitCostHT) sur les
 * ventes reelles de la periode. unitCostHT est le snapshot fige a la
 * creation de la ligne (voir SaleLine.unitCostHT) - jamais une jointure
 * Product.purchasePrice courante. Fiabilite : EXACTE pour toute ligne creee
 * apres la migration 20260904130000 ; APPROXIMATIVE (backfill) pour les
 * lignes anterieures (voir le commentaire de cette migration).
 */
export async function grossMarginHT(organizationId: string, period: BiPeriod): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ margin: number }>>(Prisma.sql`
    SELECT COALESCE(SUM(sl."totalHT" - sl.quantity * sl."unitCostHT"), 0)::float8 AS margin
    FROM "SaleLine" sl
    JOIN "Sale" s ON sl."saleId" = s.id
    WHERE s."organizationId" = ${organizationId}
      AND s.status::text = ANY(${REAL_SALE_STATUSES})
      AND s."validatedAt" >= ${period.from} AND s."validatedAt" < ${period.to}
  `);
  return roundMoney(rows[0]?.margin ?? 0);
}

/**
 * Taux de MARQUE (pas taux de marge) = Marge brute HT / CA HT * 100 - la
 * convention retenue pour le Dashboard Direction (voir l'audit Phase 1 §5).
 * 0 si CA HT = 0.
 */
export async function markupRate(organizationId: string, period: BiPeriod): Promise<number> {
  const [{ ht }, margin] = await Promise.all([
    revenue(organizationId, period),
    grossMarginHT(organizationId, period),
  ]);
  return ht > 0 ? roundMoney((margin / ht) * 100) : 0;
}

/** Total achats HT valides (ORDERED/PARTIALLY_RECEIVED/RECEIVED), date sur
 * orderDate. Toujours separe des charges de fonctionnement (voir totalCharges). */
export async function purchasesHT(organizationId: string, period: BiPeriod): Promise<number> {
  const agg = await prisma.purchase.aggregate({
    where: {
      organizationId,
      status: { in: REAL_PURCHASE_STATUSES },
      orderDate: { gte: period.from, lt: period.to },
    },
    _sum: { subtotalHT: true },
  });
  return roundMoney(agg._sum.subtotalHT?.toNumber() ?? 0);
}

/** Total charges de fonctionnement HT VALIDATED sur la periode (Expense,
 * jamais Purchase). Delegue a expenses.ts pour une seule implementation. */
export async function totalCharges(organizationId: string, period: BiPeriod): Promise<number> {
  return totalValidatedExpensesHT(organizationId, period.from, period.to);
}

/** Resultat estime = Marge brute HT - Charges. Indicatif seulement - ne
 * jamais l'afficher comme "resultat net comptable" (voir l'audit Phase 1 §8). */
export async function estimatedResult(organizationId: string, period: BiPeriod): Promise<number> {
  const [margin, charges] = await Promise.all([
    grossMarginHT(organizationId, period),
    totalCharges(organizationId, period),
  ]);
  return roundMoney(margin - charges);
}

/** Creances clients actuelles (org entiere) - un solde a un instant donne,
 * pas un flux sur une periode. Delegue a customer-settlements.ts. */
export async function customerReceivables(organizationId: string): Promise<number> {
  return totalCustomerReceivables(organizationId);
}

/**
 * Valeur du stock au COUT (jamais au salePrice) :
 *   SUM(max(quantity - reservedQuantity, 0) * Product.purchasePrice)
 * sur DEPOT + TRUCK. Le stock negatif ne reduit jamais la valeur (clampe a
 * 0 par ligne) - il est compte separement comme anomalie.
 */
export async function stockValueAtCost(
  organizationId: string,
): Promise<{ value: number; negativeProductCount: number }> {
  const rows = await prisma.$queryRaw<Array<{ value: number; negativeProductCount: number }>>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(sl.quantity - sl."reservedQuantity", 0) * p."purchasePrice"), 0)::float8 AS value,
        COUNT(DISTINCT sl."productId") FILTER (
          WHERE (sl.quantity - sl."reservedQuantity") < 0
        )::int AS "negativeProductCount"
      FROM "StockLevel" sl
      JOIN "Product" p ON sl."productId" = p.id
      JOIN "StockLocation" loc ON sl."locationId" = loc.id
      WHERE sl."organizationId" = ${organizationId}
        AND loc.type IN ('DEPOT', 'TRUCK')
    `,
  );
  return {
    value: roundMoney(rows[0]?.value ?? 0),
    negativeProductCount: rows[0]?.negativeProductCount ?? 0,
  };
}

export type StockAlertsSummary = {
  outOfStockProducts: number;
  lowStockProducts: number;
  negativeStockProducts: number;
};

/**
 * Rupture: available <= 0. Sous seuil: 0 < available <= minimumStock (et
 * minimumStock > 0). Negatif: available < 0 (sous-ensemble de rupture).
 * Deduplique PAR PRODUIT a travers tous les emplacements (org entiere) - le
 * detail par emplacement reste la responsabilite de /stock, pas de ce KPI.
 */
export async function stockAlerts(organizationId: string): Promise<StockAlertsSummary> {
  const rows = await prisma.$queryRaw<Array<StockAlertsSummary>>(Prisma.sql`
    SELECT
      COUNT(DISTINCT sl."productId") FILTER (
        WHERE (sl.quantity - sl."reservedQuantity") <= 0
      )::int AS "outOfStockProducts",
      COUNT(DISTINCT sl."productId") FILTER (
        WHERE (sl.quantity - sl."reservedQuantity") > 0
          AND p."minimumStock" > 0
          AND (sl.quantity - sl."reservedQuantity") <= p."minimumStock"
      )::int AS "lowStockProducts",
      COUNT(DISTINCT sl."productId") FILTER (
        WHERE (sl.quantity - sl."reservedQuantity") < 0
      )::int AS "negativeStockProducts"
    FROM "StockLevel" sl
    JOIN "Product" p ON sl."productId" = p.id
    WHERE sl."organizationId" = ${organizationId}
      AND p.status = 'ACTIVE'
  `);
  return (
    rows[0] ?? { outOfStockProducts: 0, lowStockProducts: 0, negativeStockProducts: 0 }
  );
}

/** Clients distincts ayant au moins une vente reelle sur la periode.
 * customerId IS NULL (vente comptoir anonyme) est automatiquement exclu par
 * COUNT(DISTINCT) - voir l'audit Phase 1 §12 sur pourquoi type=COUNTER
 * n'est PAS un filtre "client comptoir" fiable ici. */
export async function activeCustomers(organizationId: string, period: BiPeriod): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT COUNT(DISTINCT "customerId")::int AS n
    FROM "Sale"
    WHERE "organizationId" = ${organizationId}
      AND status::text = ANY(${REAL_SALE_STATUSES})
      AND "validatedAt" >= ${period.from} AND "validatedAt" < ${period.to}
      AND "customerId" IS NOT NULL
  `);
  return rows[0]?.n ?? 0;
}

/* =========================================================================
 * BI Phase 2B - Dashboard Direction. Additional read-only aggregates for
 * the evolution chart, category breakdown, top-products/top-customers lists
 * and the stock-watch block. Every helper below reuses the exact same
 * REAL_SALE_STATUSES / REAL_PURCHASE_STATUSES perimeter and the
 * unitCostHT-snapshot margin formula as the KPI helpers above - none of
 * these re-derive a different formula, they only change the GROUP BY.
 * ========================================================================= */

export type BiGranularity = "hour" | "day" | "week" | "month";

export type BiSeriesPoint = { bucket: string; label: string; ca: number; margin: number };

function resolveGranularity(from: Date, to: Date): BiGranularity {
  const spanDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
  if (spanDays <= 2) return "hour";
  if (spanDays <= 92) return "day";
  if (spanDays <= 366) return "week";
  return "month";
}

async function queryCaAndMarginByBucket(
  organizationId: string,
  period: BiPeriod,
  granularity: BiGranularity,
): Promise<Array<{ bucket: Date; ca: number; margin: number }>> {
  return prisma.$queryRaw<Array<{ bucket: Date; ca: number; margin: number }>>(Prisma.sql`
    WITH ca_by_bucket AS (
      SELECT date_trunc(${granularity}, "validatedAt") AS bucket, SUM("totalTTC")::float8 AS ca
      FROM "Sale"
      WHERE "organizationId" = ${organizationId}
        AND status::text = ANY(${REAL_SALE_STATUSES})
        AND "validatedAt" >= ${period.from} AND "validatedAt" < ${period.to}
      GROUP BY bucket
    ),
    margin_by_bucket AS (
      -- Separate CTE (not a direct join in ca_by_bucket) so joining SaleLine
      -- can never fan out and inflate SUM("totalTTC") - see this file's own
      -- doc comment above on why grossMarginHT already needs its own join.
      SELECT date_trunc(${granularity}, s."validatedAt") AS bucket,
             COALESCE(SUM(sl."totalHT" - sl.quantity * sl."unitCostHT"), 0)::float8 AS margin
      FROM "SaleLine" sl
      JOIN "Sale" s ON sl."saleId" = s.id
      WHERE s."organizationId" = ${organizationId}
        AND s.status::text = ANY(${REAL_SALE_STATUSES})
        AND s."validatedAt" >= ${period.from} AND s."validatedAt" < ${period.to}
      GROUP BY bucket
    )
    SELECT COALESCE(c.bucket, m.bucket) AS bucket,
           COALESCE(c.ca, 0) AS ca,
           COALESCE(m.margin, 0) AS margin
    FROM ca_by_bucket c
    FULL OUTER JOIN margin_by_bucket m ON c.bucket = m.bucket
    ORDER BY bucket ASC
  `);
}

function bucketKey(date: Date, granularity: BiGranularity): string {
  if (granularity === "hour") return date.toISOString().slice(0, 13);
  return date.toISOString().slice(0, 10);
}

function bucketLabel(date: Date, granularity: BiGranularity): string {
  if (granularity === "hour") {
    return `${date.getHours().toString().padStart(2, "0")}h`;
  }
  if (granularity === "month") {
    return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" }).format(date);
  }
  const short = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(date);
  return granularity === "week" ? `S. ${short}` : short;
}

function stepBucket(date: Date, granularity: BiGranularity): Date {
  const next = new Date(date);
  if (granularity === "hour") next.setHours(next.getHours() + 1);
  else if (granularity === "day") next.setDate(next.getDate() + 1);
  else if (granularity === "week") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

/** date_trunc('week', ts) anchors on the Monday of ts's week (Postgres
 * default) - mirrored here so the JS-side bucket walk lines up with what
 * the SQL actually grouped by. */
function truncToGranularity(date: Date, granularity: BiGranularity): Date {
  if (granularity === "hour") {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
  }
  if (granularity === "month") {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (granularity === "day") return day;
  const isoDayOfWeek = (day.getDay() + 6) % 7; // Monday = 0
  day.setDate(day.getDate() - isoDayOfWeek);
  return day;
}

/**
 * CA TTC + Marge brute HT par point dans le temps, pour le graphique
 * "Evolution CA & Marge". Granularite choisie automatiquement selon
 * l'etendue de la periode (heure / jour / semaine / mois) - jamais un point
 * par vente, toujours une agregation SQL groupee. Les buckets sans vente
 * sont completes a 0 (pas de trou dans la courbe).
 */
export async function salesAndMarginSeries(
  organizationId: string,
  period: BiPeriod,
): Promise<{ granularity: BiGranularity; points: BiSeriesPoint[] }> {
  let granularity = resolveGranularity(period.from, period.to);
  let rows = await queryCaAndMarginByBucket(organizationId, period, granularity);

  // "heure si donnees suffisantes, sinon jour": a same-day/yesterday window
  // with fewer than 2 non-empty hourly buckets falls back to a single-day
  // view rather than an almost-empty hourly chart.
  if (granularity === "hour" && rows.filter((row) => row.ca > 0 || row.margin !== 0).length < 2) {
    granularity = "day";
    rows = await queryCaAndMarginByBucket(organizationId, period, granularity);
  }

  const byKey = new Map(rows.map((row) => [bucketKey(new Date(row.bucket), granularity), row]));
  const points: BiSeriesPoint[] = [];
  let cursor = truncToGranularity(period.from, granularity);
  const end = period.to;
  // Bounded walk: granularity was chosen precisely so this loop never
  // exceeds a few hundred iterations (e.g. <=48 hourly buckets, <=92 daily).
  while (cursor.getTime() < end.getTime()) {
    const key = bucketKey(cursor, granularity);
    const row = byKey.get(key);
    points.push({
      bucket: cursor.toISOString(),
      label: bucketLabel(cursor, granularity),
      ca: roundMoney(row?.ca ?? 0),
      margin: roundMoney(row?.margin ?? 0),
    });
    cursor = stepBucket(cursor, granularity);
  }
  return { granularity, points };
}

export type BiCategoryBreakdownRow = {
  category: string;
  ca: number;
  percentage: number;
  unitsSold: number;
};

/**
 * Repartition du CA TTC par categorie sur la periode, avec % du total et
 * unites vendues. Regroupe au-dela des 12 premieres categories dans une
 * ligne "Autres" pour rester lisible - le % reste calcule sur le total
 * reel (toutes categories), pas seulement sur les 12 affichees.
 */
export async function categoryBreakdown(
  organizationId: string,
  period: BiPeriod,
): Promise<BiCategoryBreakdownRow[]> {
  const rows = await prisma.$queryRaw<Array<{ category: string; ca: number; units: number }>>(Prisma.sql`
    SELECT c.name AS category,
           SUM(sl."totalTTC")::float8 AS ca,
           SUM(sl.quantity)::float8 AS units
    FROM "SaleLine" sl
    JOIN "Sale" s ON sl."saleId" = s.id
    JOIN "Product" p ON sl."productId" = p.id
    JOIN "Category" c ON p."categoryId" = c.id
    WHERE s."organizationId" = ${organizationId}
      AND s.status::text = ANY(${REAL_SALE_STATUSES})
      AND s."validatedAt" >= ${period.from} AND s."validatedAt" < ${period.to}
    GROUP BY c.name
    ORDER BY ca DESC
  `);

  const grandTotal = rows.reduce((sum, row) => sum + row.ca, 0);
  const top = rows.slice(0, 12);
  const rest = rows.slice(12);

  const toShare = (ca: number) => (grandTotal > 0 ? roundMoney((ca / grandTotal) * 100) : 0);

  const result: BiCategoryBreakdownRow[] = top.map((row) => ({
    category: row.category,
    ca: roundMoney(row.ca),
    percentage: toShare(row.ca),
    unitsSold: Math.round(row.units),
  }));

  if (rest.length > 0) {
    const restCa = rest.reduce((sum, row) => sum + row.ca, 0);
    const restUnits = rest.reduce((sum, row) => sum + row.units, 0);
    result.push({
      category: "Autres",
      ca: roundMoney(restCa),
      percentage: toShare(restCa),
      unitsSold: Math.round(restUnits),
    });
  }

  return result;
}

export type BiTopProductSortBy = "revenue" | "margin" | "quantity";

export type BiTopProductRow = {
  productId: string;
  name: string;
  category: string;
  quantity: number;
  ca: number;
  margin: number;
};

/**
 * Top produits sur la periode, classes par CA / Marge / Quantite au choix
 * (une seule requete, un seul ORDER BY parametre par un switch TS exhaustif
 * sur un type union interne - jamais une valeur brute cote client). La
 * marge utilise toujours SaleLine.unitCostHT, jamais Product.purchasePrice
 * courant.
 */
export async function topProducts(
  organizationId: string,
  period: BiPeriod,
  sortBy: BiTopProductSortBy,
  limit = 10,
): Promise<BiTopProductRow[]> {
  const orderByColumn =
    sortBy === "revenue" ? Prisma.sql`ca` : sortBy === "margin" ? Prisma.sql`margin` : Prisma.sql`quantity`;

  const rows = await prisma.$queryRaw<
    Array<{ productId: string; name: string; category: string; quantity: number; ca: number; margin: number }>
  >(Prisma.sql`
    SELECT p.id AS "productId", p.name, c.name AS category,
           SUM(sl.quantity)::float8 AS quantity,
           SUM(sl."totalTTC")::float8 AS ca,
           SUM(sl."totalHT" - sl.quantity * sl."unitCostHT")::float8 AS margin
    FROM "SaleLine" sl
    JOIN "Sale" s ON sl."saleId" = s.id
    JOIN "Product" p ON sl."productId" = p.id
    JOIN "Category" c ON p."categoryId" = c.id
    WHERE s."organizationId" = ${organizationId}
      AND s.status::text = ANY(${REAL_SALE_STATUSES})
      AND s."validatedAt" >= ${period.from} AND s."validatedAt" < ${period.to}
    GROUP BY p.id, p.name, c.name
    ORDER BY ${orderByColumn} DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    category: row.category,
    quantity: Math.round(row.quantity),
    ca: roundMoney(row.ca),
    margin: roundMoney(row.margin),
  }));
}

export type BiTopCustomerRow = {
  customerId: string;
  name: string;
  salesCount: number;
  ca: number;
};

/** Top clients par CA TTC sur la periode (ventes reelles, customerId non
 * nul). La creance actuelle de chaque client est calculee a part par
 * l'orchestrateur via getCustomerDebt (customer-settlements.ts) - jamais
 * recalculee ici. */
export async function topCustomersByRevenue(
  organizationId: string,
  period: BiPeriod,
  limit = 5,
): Promise<BiTopCustomerRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ customerId: string; name: string; salesCount: number; ca: number }>
  >(Prisma.sql`
    SELECT s."customerId" AS "customerId", cu.name AS name,
           COUNT(*)::int AS "salesCount",
           SUM(s."totalTTC")::float8 AS ca
    FROM "Sale" s
    JOIN "Customer" cu ON cu.id = s."customerId"
    WHERE s."organizationId" = ${organizationId}
      AND s.status::text = ANY(${REAL_SALE_STATUSES})
      AND s."validatedAt" >= ${period.from} AND s."validatedAt" < ${period.to}
      AND s."customerId" IS NOT NULL
    GROUP BY s."customerId", cu.name
    ORDER BY ca DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({ ...row, ca: roundMoney(row.ca) }));
}

export type BiStockSeverity = "negative" | "rupture" | "low";

export type BiCriticalStockProduct = {
  productId: string;
  name: string;
  reference: string;
  available: number;
  minimumStock: number;
  severity: BiStockSeverity;
};

/**
 * Top produits les plus critiques (stock negatif d'abord, puis rupture,
 * puis sous seuil), pour completer le bloc "A surveiller - Stock" au-dela
 * des seuls compteurs de stockAlerts(). Meme semantique par ligne
 * (emplacement) que stockAlerts - un produit est retenu des qu'AU MOINS UN
 * de ses emplacements est en alerte, classe sur son pire emplacement
 * (MIN(available)) pour rester coherent avec les compteurs affiches
 * au-dessus de cette liste.
 */
export async function criticalStockProducts(
  organizationId: string,
  limit = 5,
): Promise<BiCriticalStockProduct[]> {
  const rows = await prisma.$queryRaw<
    Array<{ productId: string; name: string; reference: string; worstAvailable: number; minimumStock: number }>
  >(Prisma.sql`
    SELECT p.id AS "productId", p.name, p.reference,
           MIN(sl.quantity - sl."reservedQuantity")::int AS "worstAvailable",
           p."minimumStock"::int AS "minimumStock"
    FROM "StockLevel" sl
    JOIN "Product" p ON sl."productId" = p.id
    WHERE sl."organizationId" = ${organizationId}
      AND p.status = 'ACTIVE'
    GROUP BY p.id, p.name, p.reference, p."minimumStock"
    HAVING MIN(sl.quantity - sl."reservedQuantity") <= 0
        OR (p."minimumStock" > 0 AND MIN(sl.quantity - sl."reservedQuantity") <= p."minimumStock")
    ORDER BY
      CASE
        WHEN MIN(sl.quantity - sl."reservedQuantity") < 0 THEN 0
        WHEN MIN(sl.quantity - sl."reservedQuantity") = 0 THEN 1
        ELSE 2
      END ASC,
      MIN(sl.quantity - sl."reservedQuantity") ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    reference: row.reference,
    available: row.worstAvailable,
    minimumStock: row.minimumStock,
    severity: row.worstAvailable < 0 ? "negative" : row.worstAvailable === 0 ? "rupture" : "low",
  }));
}
