import "server-only";

import type { PurchaseStatus, SaleStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/server/auth";
import { getStockLevels, getStockSummary } from "@/lib/server/stock-levels";

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

export async function getDashboardData(): Promise<DashboardData> {
  await requireSessionUser(["admin", "depot_manager", "cashier"]);

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const last7Start = addDays(today, -6);
  const previous7Start = addDays(today, -13);
  const previous7End = addDays(today, -6);
  const last30Start = addDays(today, -29);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [salesLast30, salesLast14, salesLatest, salesLinesLast30, purchasesMonth, stockSummary, stockLevels] =
    await Promise.all([
      prisma.sale.findMany({
        where: {
          createdAt: { gte: last30Start, lt: tomorrow },
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
        orderBy: { createdAt: "asc" },
      }),
      prisma.sale.findMany({
        where: {
          createdAt: { gte: previous7Start, lt: tomorrow },
          status: { in: postedSaleStatuses },
        },
        select: {
          id: true,
          totalTTC: true,
          createdAt: true,
        },
      }),
      prisma.sale.findMany({
        where: {
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
      prisma.saleLine.findMany({
        where: {
          sale: {
            createdAt: { gte: last30Start, lt: tomorrow },
            status: { in: postedSaleStatuses },
          },
        },
        select: {
          productId: true,
          quantity: true,
          totalTTC: true,
          product: {
            select: {
              name: true,
              category: { select: { name: true } },
            },
          },
        },
      }),
      prisma.purchase.aggregate({
        where: {
          orderDate: { gte: monthStart, lt: tomorrow },
          status: { in: purchaseStatuses },
        },
        _sum: { totalTTC: true },
      }),
      getStockSummary(),
      getStockLevels(),
    ]);

  const salesLast7 = salesLast14.filter((sale) => sale.createdAt >= last7Start);
  const previous7Sales = salesLast14.filter(
    (sale) => sale.createdAt >= previous7Start && sale.createdAt < previous7End,
  );

  const revenueLast7 = sumTotals(salesLast7.map((sale) => sale.totalTTC.toNumber()));
  const revenuePrevious7 = sumTotals(previous7Sales.map((sale) => sale.totalTTC.toNumber()));
  const avgLast7 = salesLast7.length > 0 ? revenueLast7 / salesLast7.length : 0;
  const avgPrevious7 = previous7Sales.length > 0 ? revenuePrevious7 / previous7Sales.length : 0;
  const monthCharges = purchasesMonth._sum.totalTTC?.toNumber() ?? 0;

  const heroCards: DashboardHeroCard[] = [
    {
      eyebrow: "Business Snapshot",
      title: "COMDIS",
      description: `${salesLast7.length} ventes validees sur les 7 derniers jours.`,
    },
    {
      eyebrow: "System Status",
      title: "Operations stables",
      description: `${stockSummary.lowStockCount} seuils bas et ${stockSummary.outOfStockCount} ruptures a surveiller.`,
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
      value: salesLast7.length.toLocaleString("fr-FR"),
      helper: "Factures enregistrees et confirmees.",
      accent: "green",
      trend: buildTrend(salesLast7.length, previous7Sales.length, { suffix: " vs semaine precedente" }),
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
      value: formatMoney(stockSummary.totalValue),
      helper: `${stockSummary.productCount.toLocaleString("fr-FR")} produits suivis sur l'ensemble des emplacements.`,
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

  const salesByDay = new Map<string, number>();
  for (let index = 0; index < 30; index += 1) {
    const day = addDays(last30Start, index);
    salesByDay.set(day.toISOString().slice(0, 10), 0);
  }
  for (const sale of salesLast30) {
    const key = startOfDay(sale.createdAt).toISOString().slice(0, 10);
    salesByDay.set(key, (salesByDay.get(key) ?? 0) + sale.totalTTC.toNumber());
  }
  const salesTrend = Array.from(salesByDay.entries()).map(([isoDate, amount]) => ({
    date: formatShortDate(new Date(`${isoDate}T00:00:00`)),
    ventes: roundTo2(amount),
  }));

  const categoryTotals = new Map<string, number>();
  const productTotals = new Map<string, { name: string; category: string; unitsSold: number; revenue: number }>();
  for (const line of salesLinesLast30) {
    const categoryName = line.product.category.name;
    const revenue = line.totalTTC.toNumber();

    categoryTotals.set(categoryName, (categoryTotals.get(categoryName) ?? 0) + revenue);

    const currentProduct = productTotals.get(line.productId) ?? {
      name: line.product.name,
      category: categoryName,
      unitsSold: 0,
      revenue: 0,
    };

    currentProduct.unitsSold += line.quantity;
    currentProduct.revenue += revenue;
    productTotals.set(line.productId, currentProduct);
  }

  const totalCategoryRevenue = Array.from(categoryTotals.values()).reduce((sum, value) => sum + value, 0);
  const categoryColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
  const categorySales = Array.from(categoryTotals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([category, value], index) => ({
      category,
      value: totalCategoryRevenue > 0 ? roundTo2((value / totalCategoryRevenue) * 100) : 0,
      color: categoryColors[index % categoryColors.length],
    }));

  const topProducts = Array.from(productTotals.entries())
    .map(([id, product]) => ({
      id,
      name: product.name,
      category: product.category,
      unitsSold: product.unitsSold,
      revenue: formatMoney(product.revenue),
    }))
    .sort((left, right) => right.unitsSold - left.unitsSold)
    .slice(0, 5);

  const stockAlerts = stockLevels
    .filter((level) => level.minimumStock > 0 && level.availableQuantity <= level.minimumStock)
    .sort((left, right) => {
      if (left.availableQuantity === 0 && right.availableQuantity > 0) return -1;
      if (right.availableQuantity === 0 && left.availableQuantity > 0) return 1;
      return left.availableQuantity - right.availableQuantity;
    })
    .slice(0, 5)
    .map((level): DashboardStockAlert => ({
      id: level.id,
      product: level.productName,
      sku: level.productReference,
      quantity: level.availableQuantity,
      threshold: level.minimumStock,
      severity: level.availableQuantity === 0 ? "critique" : "faible",
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

function sumTotals(values: number[]) {
  return roundTo2(values.reduce((sum, value) => sum + value, 0));
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

function roundTo2(value: number) {
  return Math.round(value * 100) / 100;
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
