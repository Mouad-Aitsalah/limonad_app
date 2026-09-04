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
