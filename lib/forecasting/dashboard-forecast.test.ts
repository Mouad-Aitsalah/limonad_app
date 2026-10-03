import assert from "node:assert/strict";
import { test } from "node:test";

import type { DashboardForecastDto } from "@/types/dashboard-forecast";

import {
  assessForecastQuality,
  buildDashboardForecast,
  daysBetween,
  FORECAST_LOAD_ERROR_MESSAGE,
  FORECAST_TABLE_LIMIT,
  getDashboardForecastFor,
  loadDashboardForecast,
  sumDailyForecast,
  type ForecastProductInfo,
} from "./dashboard-forecast";
import { canViewForecast, FORECAST_VIEW_ROLES } from "./forecast-access";
import { queryLastSaleDayByProduct, type ForecastDb } from "./product-daily-sales";
import type { PurchaseRecommendation } from "./purchase-recommendation";
import type { SnapshotRow } from "./purchase-forecast-snapshot";

// ---- fixtures (test data only: nothing here is ever shown in the application) -------------------

function rec(overrides: Partial<PurchaseRecommendation> = {}): PurchaseRecommendation {
  return {
    productId: "p1",
    productName: "Coca 2L",
    productStatus: "ACTIVE",
    currentStock: 10,
    stockKnown: true,
    stockRegularizationRequired: false,
    forecast1Day: 2,
    forecast3Days: 6,
    forecast7Days: 14,
    safetyStock: 4,
    safetyStockRule: "demand_variability",
    targetStock: 18,
    recommendedPurchaseQuantity: 8,
    model: "moving_average",
    mae: 1.2,
    reliability: "sufficient",
    noRecentSales: false,
    evaluable: true,
    historyDays: 90,
    soldDays: 60,
    reason: "Le stock actuel (10) est inférieur au stock cible (18).",
    ...overrides,
  };
}

function snap(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    organizationId: "org1",
    businessDay: "2026-10-03",
    productId: "p1",
    productName: "Coca 2L",
    forecast1Day: 2,
    forecast3Days: 6,
    forecast7Days: 14,
    predictedQuantityRaw: 14.2,
    model: "moving_average",
    mae: 1.2,
    reliability: "sufficient",
    historyDays: 90,
    soldDays: 60,
    computedAt: new Date("2026-10-03T00:10:00.000Z"),
    dailyForecast: [
      { date: "2026-10-03", quantity: 2.4 },
      { date: "2026-10-04", quantity: 1.6 },
    ],
    ...overrides,
  };
}

const products = new Map<string, ForecastProductInfo>([
  ["p1", { reference: "COCA-2L", status: "ACTIVE", salePrice: 10, taxRate: 20 }],
  ["p2", { reference: "EAU-5L", status: "ACTIVE", salePrice: 5, taxRate: 20 }],
]);

// ---- quality ------------------------------------------------------------------------------------

test("quality: insufficient when no product has at least a limited history", () => {
  assert.equal(assessForecastQuality({ sufficient: 0, limited: 0, very_limited: 5, none: 2 }), "insufficient");
  assert.equal(assessForecastQuality({ sufficient: 0, limited: 0, very_limited: 0, none: 0 }), "insufficient");
});

test("quality: sufficient from half of the products, limited otherwise", () => {
  assert.equal(assessForecastQuality({ sufficient: 5, limited: 0, very_limited: 5, none: 0 }), "sufficient");
  assert.equal(assessForecastQuality({ sufficient: 4, limited: 1, very_limited: 5, none: 0 }), "limited");
  assert.equal(assessForecastQuality({ sufficient: 0, limited: 3, very_limited: 0, none: 0 }), "limited");
});

// ---- daily chart data ---------------------------------------------------------------------------

test("daily: sums the per-product predictions per date, rounds once, sorted by date", () => {
  const daily = sumDailyForecast([
    { dailyForecast: [{ date: "2026-10-04", quantity: 1.4 }, { date: "2026-10-03", quantity: 2.4 }] },
    { dailyForecast: [{ date: "2026-10-03", quantity: 0.4 }, { date: "2026-10-04", quantity: 0.4 }] },
  ]);
  assert.deepEqual(daily, [
    { date: "2026-10-03", quantity: 3 }, // 2.8 -> 3
    { date: "2026-10-04", quantity: 2 }, // 1.8 -> 2
  ]);
});

test("daily: null (never partial or invented) when any product has no stored detail or there is no row", () => {
  assert.equal(sumDailyForecast([]), null);
  assert.equal(sumDailyForecast([{ dailyForecast: null }]), null);
  assert.equal(
    sumDailyForecast([{ dailyForecast: [{ date: "2026-10-03", quantity: 1 }] }, { dailyForecast: undefined }]),
    null,
  );
  assert.equal(sumDailyForecast([{ dailyForecast: [] }]), null);
});

test("daily: a zero forecast stays 0 (no negative, no NaN)", () => {
  assert.deepEqual(sumDailyForecast([{ dailyForecast: [{ date: "2026-10-03", quantity: 0 }] }]), [
    { date: "2026-10-03", quantity: 0 },
  ]);
});

// ---- builder ------------------------------------------------------------------------------------

test("empty: no snapshot at all", () => {
  assert.deepEqual(buildDashboardForecast({ today: "2026-10-03", snapshot: null, recommendations: [], products }), {
    status: "empty",
    reason: "no_snapshot",
  });
  assert.deepEqual(
    buildDashboardForecast({ today: "2026-10-03", snapshot: { businessDay: "2026-10-03", rows: [] }, recommendations: [], products }),
    { status: "empty", reason: "no_snapshot" },
  );
});

test("empty: a snapshot exists but no ACTIVE product is forecast", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ productStatus: "INACTIVE" }), rec({ productId: "p9", productStatus: "DISCONTINUED" })],
    products,
  });
  assert.deepEqual(out, { status: "empty", reason: "no_products" });
});

test("ready: KPIs are the exact sums; revenue = forecast units x current price TTC", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap(), snap({ productId: "p2", productName: "Eau 5L" })] },
    recommendations: [
      rec(),
      rec({ productId: "p2", productName: "Eau 5L", forecast7Days: 30, recommendedPurchaseQuantity: 0, currentStock: 100 }),
    ],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.totalUnits7Days, 44); // 14 + 30
  // 14 x (10 x 1.2 = 12.00) + 30 x (5 x 1.2 = 6.00) = 168 + 180
  assert.equal(out.revenue7Days, 348);
  assert.equal(out.isCurrent, true);
  assert.equal(out.toOrderCount, 1);
  assert.equal(out.negativeStockCount, 0);
  assert.equal(out.computedAt, "2026-10-03T00:10:00.000Z");
  assert.deepEqual(out.daily, [
    { date: "2026-10-03", quantity: 5 }, // 2.4 + 2.4
    { date: "2026-10-04", quantity: 3 }, // 1.6 + 1.6
  ]);
});

test("ready: rows carry reference, stock, forecast, recommendation and reliability; sorted by quantity to order", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap(), snap({ productId: "p2" })] },
    recommendations: [
      rec({ productId: "p2", productName: "Eau 5L", recommendedPurchaseQuantity: 3, forecast7Days: 50, reliability: "limited" }),
      rec({ recommendedPurchaseQuantity: 8 }),
    ],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.deepEqual(
    out.rows.map((row) => [row.reference, row.recommendedQuantity, row.reliability]),
    [
      ["COCA-2L", 8, "sufficient"],
      ["EAU-5L", 3, "limited"],
    ],
  );
  assert.equal(out.rows[0].currentStock, 10);
  assert.equal(out.rows[0].forecast7Days, 14);
});

test("ready: an inactive product is neither listed nor counted in the KPIs", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap(), snap({ productId: "p2" })] },
    recommendations: [rec(), rec({ productId: "p2", productStatus: "INACTIVE", forecast7Days: 999 })],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.rows.length, 1);
  assert.equal(out.totalUnits7Days, 14);
});

test("ready: zero quantities everywhere stay valid (no division, no negative)", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap({ dailyForecast: [{ date: "2026-10-03", quantity: 0 }] })] },
    recommendations: [rec({ forecast7Days: 0, forecast3Days: 0, forecast1Day: 0, recommendedPurchaseQuantity: 0, currentStock: 0 })],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.totalUnits7Days, 0);
  assert.equal(out.revenue7Days, 0);
  assert.equal(out.toOrderCount, 0);
});

test("ready: a negative stock is flagged, never turned into a purchase, and counted", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ currentStock: -4, stockRegularizationRequired: true, recommendedPurchaseQuantity: 0 })],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.negativeStockCount, 1);
  assert.equal(out.toOrderCount, 0);
  assert.equal(out.rows[0].stockRegularizationRequired, true);
  assert.equal(out.rows[0].recommendedQuantity, 0);
});

test("ready: a product without price information adds units but no revenue (never a guessed price)", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ productId: "unknown", productName: "Sans fiche" })],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.totalUnits7Days, 14);
  assert.equal(out.revenue7Days, 0);
  assert.equal(out.rows[0].reference, "-");
});

test("ready: an earlier snapshot is shown but flagged as not current", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-02", rows: [snap({ businessDay: "2026-10-02" })] },
    recommendations: [rec()],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.isCurrent, false);
  assert.equal(out.businessDay, "2026-10-02");
});

test("ready: no stored time / no stored daily detail -> null, not a made-up value", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap({ computedAt: null, dailyForecast: null })] },
    recommendations: [rec()],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.computedAt, null);
  assert.equal(out.daily, null);
});

test("ready: the table is capped and the remainder is counted", () => {
  const many = Array.from({ length: FORECAST_TABLE_LIMIT + 5 }, (_, i) =>
    rec({ productId: `p${i}`, productName: `Produit ${String(i).padStart(2, "0")}`, recommendedPurchaseQuantity: i }),
  );
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: many,
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.rows.length, FORECAST_TABLE_LIMIT);
  assert.equal(out.hiddenRowCount, 5);
  assert.equal(out.rows[0].recommendedQuantity, FORECAST_TABLE_LIMIT + 4, "largest quantity first");
});

test("ready: insufficient history is announced (very limited everywhere)", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ reliability: "very_limited" }), rec({ productId: "p2", reliability: "none" })],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.quality, "insufficient");
  assert.deepEqual(out.reliabilityCounts, { sufficient: 0, limited: 0, very_limited: 1, none: 1 });
});

// ---- database path (fake db: proves the engine is never run and the cache is what is read) ------

type FakeOptions = {
  latestDay?: string | null;
  snapshotRows?: Array<Record<string, unknown>>;
  failOn?: "snapshot" | "stock";
  missingExtraColumns?: boolean;
  /** Rows of the "last sale day per product" query; default: one sale on 2026-10-01. */
  lastSaleRows?: Array<{ productId: string; day: string }>;
  /** Daily sales of the 28-day window; default: one sale of 3 on 2026-10-01. */
  recentSales?: Array<{ day: string; productId: string; productName: string; quantity: number }>;
};

function fakeDb(options: FakeOptions = {}) {
  const calls = { salesQueries: 0, stockQueries: 0, lastSaleQueries: 0, findManyArgs: [] as unknown[] };
  const base = (productId: string) => ({
    productId,
    productName: "Coca 2L",
    forecast1Day: 2,
    forecast3Days: 6,
    forecast7Days: 14,
    predictedQuantityRaw: 14.2,
    model: "moving_average",
    mae: 1.2,
    reliability: "sufficient",
    historyDays: 90,
    soldDays: 60,
  });
  const rows = options.snapshotRows ?? [
    {
      ...base("p1"),
      computedAt: new Date("2026-10-03T00:10:00.000Z"),
      dailyForecast: [{ date: "2026-10-03", quantity: 2.4 }],
    },
  ];
  const db = {
    purchaseForecastSnapshot: {
      findFirst: async () => {
        if (options.failOn === "snapshot") throw new Error("connexion perdue");
        return options.latestDay === null ? null : { businessDay: options.latestDay ?? "2026-10-03" };
      },
      findMany: async (args: { select: Record<string, boolean> }) => {
        calls.findManyArgs.push(args);
        if (options.missingExtraColumns && args.select.computedAt) {
          throw Object.assign(new Error("The column `PurchaseForecastSnapshot.computedAt` does not exist in the current database."), {
            code: "P2022",
          });
        }
        return rows.map((row) => {
          const { computedAt, dailyForecast, ...rest } = row;
          return args.select.computedAt ? { ...rest, computedAt, dailyForecast } : rest;
        });
      },
    },
    product: {
      findMany: async (args: { select: Record<string, boolean> }) =>
        args.select.reference
          ? [{ id: "p1", reference: "COCA-2L", status: "ACTIVE", salePrice: 10, taxRate: 20 }]
          : [{ id: "p1", name: "Coca 2L", status: "ACTIVE", createdAt: new Date("2026-01-01T00:00:00Z") }],
    },
    $queryRaw: async (query: { sql?: string; strings?: readonly string[] }) => {
      const text = query.sql ?? (query.strings ?? []).join("?");
      if (text.includes('"StockLevel"')) {
        calls.stockQueries += 1;
        if (options.failOn === "stock") throw new Error("panne stock");
        return [{ productId: "p1", stock: 10 }];
      }
      if (text.includes("MAX(")) {
        calls.lastSaleQueries += 1;
        return options.lastSaleRows ?? [{ productId: "p1", day: "2026-10-01" }];
      }
      calls.salesQueries += 1;
      return options.recentSales ?? [{ day: "2026-10-01", productId: "p1", productName: "Coca 2L", quantity: 3 }];
    },
  };
  return { db: db as unknown as ForecastDb, calls };
}

const NOW = new Date("2026-10-03T12:00:00.000Z");

test("db: reads the cached snapshot, the live stock and the price - no forecast engine run", async () => {
  const { db, calls } = fakeDb();
  const out = await getDashboardForecastFor(db, "org1", NOW);
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.totalUnits7Days, 14);
  assert.equal(out.revenue7Days, 168); // 14 x 12.00 TTC
  assert.equal(out.rows[0].reference, "COCA-2L");
  assert.equal(out.rows[0].currentStock, 10);
  // safety = ceil(1.28 x sigma(28 days: one sale of 3) x sqrt(7)) = 2 -> target 14 + 2 = 16, stock 10
  assert.equal(out.rows[0].recommendedQuantity, 6);
  assert.equal(out.isCurrent, true);
  assert.equal(calls.stockQueries, 1, "live stock read once");
  // the only sales query is the bounded 28-day safety window, never the full-history engine
  assert.equal(calls.salesQueries, 1);
});

test("db: no snapshot -> empty state (the engine is not run to fill it)", async () => {
  const { db, calls } = fakeDb({ latestDay: null });
  assert.deepEqual(await getDashboardForecastFor(db, "org1", NOW), { status: "empty", reason: "no_snapshot" });
  assert.equal(calls.salesQueries + calls.stockQueries, 0);
});

test("db: a database without the two new columns still works (no daily detail, no time)", async () => {
  const { db } = fakeDb({ missingExtraColumns: true });
  const out = await getDashboardForecastFor(db, "org1", NOW);
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.daily, null);
  assert.equal(out.computedAt, null);
  assert.equal(out.totalUnits7Days, 14);
});

test("db: a snapshot of an earlier day is read when today's is missing", async () => {
  const { db } = fakeDb({ latestDay: "2026-10-01" });
  const out = await getDashboardForecastFor(db, "org1", NOW);
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.isCurrent, false);
  assert.equal(out.businessDay, "2026-10-01");
});

// ---- permissions and errors ---------------------------------------------------------------------

test("permissions: only admin and depot manager may see the section", () => {
  assert.deepEqual([...FORECAST_VIEW_ROLES].sort(), ["admin", "depot_manager"]);
  assert.equal(canViewForecast("admin"), true);
  assert.equal(canViewForecast("depot_manager"), true);
  for (const role of ["cashier", "driver", "super_admin", undefined, null] as const) {
    assert.equal(canViewForecast(role), false, String(role));
  }
});

test("permissions: a refused role never reaches the data (the 403 is not swallowed)", async () => {
  let loaded = false;
  await assert.rejects(
    loadDashboardForecast({
      requireUser: async () => {
        throw Object.assign(new Error("Acces non autorise."), { status: 403 });
      },
      load: async () => {
        loaded = true;
        return { status: "empty", reason: "no_snapshot" };
      },
    }),
    /Acces non autorise/,
  );
  assert.equal(loaded, false);
});

test("permissions: the organisation comes from the session, never from the caller", async () => {
  let seen = "";
  const out = await loadDashboardForecast({
    requireUser: async () => ({ organizationId: "org-from-session" }),
    load: async (organizationId) => {
      seen = organizationId;
      return { status: "empty", reason: "no_snapshot" };
    },
  });
  assert.equal(seen, "org-from-session");
  assert.equal(out.status, "empty");
});

test("errors: a failing read becomes an error state, reported once, without leaking the cause", async () => {
  const reported: unknown[] = [];
  const out: DashboardForecastDto = await loadDashboardForecast({
    requireUser: async () => ({ organizationId: "org1" }),
    load: async () => {
      throw new Error("password authentication failed for user neondb_owner");
    },
    report: (error) => reported.push(error),
  });
  assert.deepEqual(out, { status: "error", message: FORECAST_LOAD_ERROR_MESSAGE });
  assert.equal(reported.length, 1);
  assert.equal(JSON.stringify(out).includes("neondb_owner"), false);
});

test("errors: real read failures (snapshot / stock) surface as an error state through the whole chain", async () => {
  for (const failOn of ["snapshot", "stock"] as const) {
    const { db } = fakeDb({ failOn });
    const out = await loadDashboardForecast({
      requireUser: async () => ({ organizationId: "org1" }),
      load: (organizationId) => getDashboardForecastFor(db, organizationId, NOW),
    });
    assert.equal(out.status, "error", failOn);
  }
});

// ---- recency of sales and "Non évaluable" ------------------------------------------------------

test("daysBetween: whole days, never negative", () => {
  assert.equal(daysBetween("2026-08-25", "2026-10-02"), 38);
  assert.equal(daysBetween("2026-10-02", "2026-10-02"), 0);
  assert.equal(daysBetween("2026-10-05", "2026-10-02"), 0);
});

test("rows carry the last sale date and the days without sale (reference day = the day before the snapshot's)", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ noRecentSales: true, reliability: "limited" })],
    products,
    lastSaleDays: new Map([["p1", "2026-08-25"]]),
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.rows[0].lastSaleDate, "2026-08-25");
  assert.equal(out.rows[0].daysSinceLastSale, 38);
  assert.equal(out.rows[0].noRecentSales, true);
  assert.equal(out.rows[0].reliability, "limited");
});

test("zero forecast with an old history: the notice gives the catalogue's latest sale and the days without sale", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap(), snap({ productId: "p2" })] },
    recommendations: [
      rec({ forecast7Days: 0, recommendedPurchaseQuantity: 0, noRecentSales: true }),
      rec({ productId: "p2", productName: "Eau 5L", forecast7Days: 0, recommendedPurchaseQuantity: 0, noRecentSales: true }),
    ],
    products,
    lastSaleDays: new Map([
      ["p1", "2026-08-11"],
      ["p2", "2026-08-25"],
    ]),
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.totalUnits7Days, 0);
  assert.deepEqual(out.noRecentSales, { lastSaleDate: "2026-08-25", daysWithoutSale: 38 });
});

test("zero forecast, last sale unknown: the notice is still produced, with null figures (nothing invented)", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ forecast7Days: 0, recommendedPurchaseQuantity: 0, noRecentSales: true })],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.deepEqual(out.noRecentSales, { lastSaleDate: null, daysWithoutSale: null });
});

test("no notice when the forecast is not zero, or when it is zero without a 'no recent sales' product", () => {
  const nonZero = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ noRecentSales: true })],
    products,
  });
  assert.equal(nonZero.status === "ready" && nonZero.noRecentSales, null);
  const zeroButRecent = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ forecast7Days: 0, recommendedPurchaseQuantity: 0, noRecentSales: false })],
    products,
  });
  assert.equal(zeroButRecent.status === "ready" && zeroButRecent.noRecentSales, null);
});

test("'Non évaluable' reaches the rows: mae null + evaluable false stay as computed by the recommendation", () => {
  const out = buildDashboardForecast({
    today: "2026-10-03",
    snapshot: { businessDay: "2026-10-03", rows: [snap()] },
    recommendations: [rec({ mae: null, evaluable: false })],
    products,
  });
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(out.rows[0].mae, null);
  assert.equal(out.rows[0].evaluable, false);
});

test("db: a product with no sale in the last 28 days is flagged, its last sale found, accuracy not evaluable", async () => {
  const { db, calls } = fakeDb({
    lastSaleRows: [{ productId: "p1", day: "2026-08-25" }],
    recentSales: [], // nothing in the 28-day window
  });
  // the snapshot row of this product has a MAE of 0 (all-zero test window)
  const out = await getDashboardForecastFor(db, "org1", NOW);
  assert.equal(out.status, "ready");
  if (out.status !== "ready") return;
  assert.equal(calls.lastSaleQueries, 1, "one aggregated, read-only last-sale query");
  const row = out.rows[0];
  assert.equal(row.noRecentSales, true);
  assert.equal(row.reliability, "limited", "sufficient history lowered by one level");
  assert.equal(row.lastSaleDate, "2026-08-25");
  assert.equal(row.daysSinceLastSale, 38);
  assert.equal(row.evaluable, false);
  assert.equal(row.mae, null);
});

test("queryLastSaleDayByProduct: read-only, same sale perimeter and organisation scope, never-sold products absent", async () => {
  let text = "";
  const db = {
    $queryRaw: async (query: { sql?: string; strings?: readonly string[] }) => {
      text = query.sql ?? (query.strings ?? []).join("?");
      return [{ productId: "p1", day: "2026-08-25" }];
    },
  } as unknown as ForecastDb;
  const map = await queryLastSaleDayByProduct(db, "org1", "2026-10-02");
  assert.deepEqual([...map], [["p1", "2026-08-25"]]);
  assert.match(text, /SELECT/);
  assert.equal(/INSERT|UPDATE|DELETE/i.test(text), false);
  for (const guard of ['s."organizationId"', 'p."organizationId"', "s.status::text", '"validatedAt" IS NOT NULL', "GROUP BY"]) {
    assert.ok(text.includes(guard), guard);
  }
  await assert.rejects(queryLastSaleDayByProduct(db, "org1", "pas-une-date"), /YYYY-MM-DD/);
});
