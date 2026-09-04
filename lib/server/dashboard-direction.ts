import "server-only";

import { formatCurrency } from "@/lib/currency";
import { resolveDirectionPeriod } from "@/lib/dashboard-period";
import { roundMoney } from "@/lib/money";
import {
  activeCustomers,
  avgBasket,
  categoryBreakdown,
  criticalStockProducts,
  customerReceivables,
  estimatedResult,
  grossMarginHT,
  purchasesHT,
  revenue,
  salesAndMarginSeries,
  salesCount,
  stockAlerts,
  stockValueAtCost,
  topCustomersByRevenue,
  topProducts,
  totalCharges,
  type BiPeriod,
} from "@/lib/server/dashboard-bi";
import { getCustomerDebt } from "@/lib/server/customer-settlements";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type {
  DirectionCategoryPoint,
  DirectionDashboardDto,
  DirectionKpi,
  DirectionTopProductRow,
  DirectionTrend,
  DirectionWatchItem,
} from "@/types/dashboard-direction";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/**
 * SaleLine.unitCostHT is EXACT for every line created after this migration
 * (see prisma/migrations/20260904130000_add_saleline_unit_cost_ht) and an
 * APPROXIMATION (backfilled from Product.purchasePrice at migration time)
 * for lines created before it - the marge card shows a small note only when
 * the selected period actually overlaps that older, approximate history.
 */
const UNIT_COST_SNAPSHOT_START = new Date(2026, 8, 4); // 2026-09-04, local

function buildTrend(current: number, previous: number): DirectionTrend {
  if (current === 0 && previous === 0) return { value: "Stable", direction: "neutral" };
  if (previous === 0) return { value: "+100 %", direction: "up" };
  const delta = roundMoney(((current - previous) / previous) * 100);
  if (delta === 0) return { value: "Stable", direction: "neutral" };
  return {
    value: `${delta > 0 ? "+" : ""}${delta.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`,
    direction: delta > 0 ? "up" : "down",
  };
}

function moneyKpi(id: string, label: string, current: number, previous: number): DirectionKpi {
  return { id, label, value: formatCurrency(current), trend: buildTrend(current, previous) };
}

function countKpi(id: string, label: string, current: number, previous: number): DirectionKpi {
  return {
    id,
    label,
    value: current.toLocaleString("fr-FR"),
    trend: buildTrend(current, previous),
  };
}

function formatTopProductRow(row: {
  productId: string;
  name: string;
  category: string;
  quantity: number;
  ca: number;
  margin: number;
}): DirectionTopProductRow {
  return {
    productId: row.productId,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    ca: formatCurrency(row.ca),
    margin: formatCurrency(row.margin),
  };
}

/**
 * Central server function for /dashboard (BI Phase 2B). organizationId is
 * ALWAYS derived from the session (requireOrganizationUser) - never
 * accepted from the caller/browser. Orchestrates lib/server/dashboard-bi.ts
 * (and customer-settlements.ts's getCustomerDebt) exclusively - no formula
 * is re-implemented here, this file only shapes their results into the
 * DirectionDashboardDto and computes period-over-period trends.
 */
export async function getDirectionDashboardData(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<DirectionDashboardDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = currentUser.organizationId;

  const resolution = resolveDirectionPeriod(searchParams);
  const period: BiPeriod = { from: resolution.from, to: resolution.to };
  const previousPeriod: BiPeriod = { from: resolution.previousFrom, to: resolution.previousTo };

  // Group 1: the primary KPI row/second row numbers - the dashboard's core
  // purpose. A failure here is not gracefully hidden: the page is allowed
  // to error out (no meaningful "silent" KPI card exists).
  const [
    currentRevenue,
    previousRevenue,
    currentMargin,
    previousMargin,
    currentCharges,
    previousCharges,
    currentResult,
    previousResult,
    currentSalesCount,
    previousSalesCount,
    currentAvgBasket,
    previousAvgBasket,
    currentPurchases,
    previousPurchases,
    currentActiveCustomers,
    previousActiveCustomers,
    receivables,
    stockValue,
    alerts,
  ] = await Promise.all([
    revenue(organizationId, period),
    revenue(organizationId, previousPeriod),
    grossMarginHT(organizationId, period),
    grossMarginHT(organizationId, previousPeriod),
    totalCharges(organizationId, period),
    totalCharges(organizationId, previousPeriod),
    estimatedResult(organizationId, period),
    estimatedResult(organizationId, previousPeriod),
    salesCount(organizationId, period),
    salesCount(organizationId, previousPeriod),
    avgBasket(organizationId, period),
    avgBasket(organizationId, previousPeriod),
    purchasesHT(organizationId, period),
    purchasesHT(organizationId, previousPeriod),
    activeCustomers(organizationId, period),
    activeCustomers(organizationId, previousPeriod),
    customerReceivables(organizationId),
    stockValueAtCost(organizationId),
    stockAlerts(organizationId),
  ]);

  // Group 2: chart/list blocks (evolution, categories, top produits/
  // clients, critical stock). Each is secondary to the KPI cards above -
  // if this whole group fails, the page still renders every KPI card and
  // simply shows each secondary block in its own empty state instead of a
  // full page crash (per spec §28 - graceful degradation where the
  // existing architecture allows it, without a heavier per-widget
  // Suspense/streaming redesign that is out of this chantier's scope).
  let evolution: Awaited<ReturnType<typeof salesAndMarginSeries>> = { granularity: "day", points: [] };
  let categories: Awaited<ReturnType<typeof categoryBreakdown>> = [];
  let critical: Awaited<ReturnType<typeof criticalStockProducts>> = [];
  let topCustomersWithDebt: DirectionDashboardDto["topCustomers"] = [];
  let topByRevenue: Awaited<ReturnType<typeof topProducts>> = [];
  let topByMargin: Awaited<ReturnType<typeof topProducts>> = [];
  let topByQuantity: Awaited<ReturnType<typeof topProducts>> = [];

  try {
    const [evolutionResult, categoriesResult, criticalResult, topByRevenueResult, topByMarginResult, topByQuantityResult, topCustomersResult] =
      await Promise.all([
        salesAndMarginSeries(organizationId, period),
        categoryBreakdown(organizationId, period),
        criticalStockProducts(organizationId, 5),
        topProducts(organizationId, period, "revenue", 10),
        topProducts(organizationId, period, "margin", 10),
        topProducts(organizationId, period, "quantity", 10),
        topCustomersByRevenue(organizationId, period, 5),
      ]);
    evolution = evolutionResult;
    categories = categoriesResult;
    critical = criticalResult;
    topByRevenue = topByRevenueResult;
    topByMargin = topByMarginResult;
    topByQuantity = topByQuantityResult;

    // Bounded to 5 customers - each getCustomerDebt() call reuses the exact
    // 2A receivables formula (never recomputed here) for that one customer.
    topCustomersWithDebt = await Promise.all(
      topCustomersResult.map(async (customer) => {
        const debt = await getCustomerDebt(customer.customerId);
        return {
          customerId: customer.customerId,
          name: customer.name,
          salesCount: customer.salesCount,
          ca: formatCurrency(customer.ca),
          receivable: formatCurrency(debt.debt),
        };
      }),
    );
  } catch (error) {
    console.error("Dashboard Direction: secondary blocks failed to load", error);
  }

  const marginNote =
    resolution.from < UNIT_COST_SNAPSHOT_START
      ? "Historique anterieur au snapshot : estimation."
      : null;

  const categoryPoints: DirectionCategoryPoint[] = categories.map((row, index) => ({
    category: row.category,
    ca: row.ca,
    percentage: row.percentage,
    unitsSold: row.unitsSold,
    color: CHART_COLORS[index % CHART_COLORS.length],
  }));

  const watchlist: DirectionWatchItem[] = [];
  if (alerts.outOfStockProducts > 0) {
    watchlist.push({
      id: "out-of-stock",
      label: `${alerts.outOfStockProducts} produit${alerts.outOfStockProducts > 1 ? "s" : ""} en rupture`,
      tone: "danger",
    });
  }
  if (alerts.negativeStockProducts > 0) {
    watchlist.push({
      id: "negative-stock",
      label: `${alerts.negativeStockProducts} produit${alerts.negativeStockProducts > 1 ? "s" : ""} en stock negatif`,
      tone: "danger",
    });
  }
  if (receivables > 0) {
    watchlist.push({
      id: "receivables",
      label: `${formatCurrency(receivables)} de creances clients`,
      tone: "warning",
    });
  }
  if (currentCharges > 0) {
    watchlist.push({
      id: "charges",
      label: `${formatCurrency(currentCharges)} de charges sur la periode`,
      tone: "neutral",
    });
  }

  return {
    period: {
      key: resolution.key,
      label: resolution.label,
      from: resolution.from.toISOString(),
      to: resolution.to.toISOString(),
      previousFrom: resolution.previousFrom.toISOString(),
      previousTo: resolution.previousTo.toISOString(),
    },
    kpis: {
      revenue: moneyKpi("revenue", "Chiffre d'affaires", currentRevenue.ttc, previousRevenue.ttc),
      grossMargin: moneyKpi("gross-margin", "Marge brute", currentMargin, previousMargin),
      estimatedResult: moneyKpi("estimated-result", "Resultat estime", currentResult, previousResult),
      customerReceivables: {
        id: "customer-receivables",
        label: "Creances clients",
        value: formatCurrency(receivables),
        helper: "Solde actuel",
      },
      stockValue: {
        id: "stock-value",
        label: "Valeur du stock",
        value: formatCurrency(stockValue.value),
        helper:
          stockValue.negativeProductCount > 0
            ? `${stockValue.negativeProductCount} produit${stockValue.negativeProductCount > 1 ? "s" : ""} en stock negatif`
            : undefined,
      },
      salesCount: countKpi("sales-count", "Nombre de ventes", currentSalesCount, previousSalesCount),
      avgBasket: moneyKpi("avg-basket", "Panier moyen", currentAvgBasket, previousAvgBasket),
      purchasesHT: moneyKpi("purchases-ht", "Achats HT", currentPurchases, previousPurchases),
      chargesHT: moneyKpi("charges-ht", "Charges HT", currentCharges, previousCharges),
      activeCustomers: countKpi(
        "active-customers",
        "Clients actifs",
        currentActiveCustomers,
        previousActiveCustomers,
      ),
    },
    marginNote,
    salesEvolution: evolution,
    categoryBreakdown: categoryPoints,
    topProducts: {
      byRevenue: topByRevenue.map(formatTopProductRow),
      byMargin: topByMargin.map(formatTopProductRow),
      byQuantity: topByQuantity.map(formatTopProductRow),
    },
    stockWatch: {
      outOfStockProducts: alerts.outOfStockProducts,
      lowStockProducts: alerts.lowStockProducts,
      negativeStockProducts: alerts.negativeStockProducts,
      critical: critical.map((row) => ({
        productId: row.productId,
        name: row.name,
        reference: row.reference,
        available: row.available,
        minimumStock: row.minimumStock,
        severity: row.severity,
      })),
    },
    topCustomers: topCustomersWithDebt,
    watchlist,
  };
}
