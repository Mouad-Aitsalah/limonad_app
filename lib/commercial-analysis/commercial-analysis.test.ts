import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCustomerRows,
  coverageRate,
  sortCoverageDrivers,
  summarize,
  summarizeCustomerRows,
} from "@/lib/commercial-analysis/coverage";
import { canViewCommercialAnalysis } from "@/lib/commercial-analysis/access";
import { AnalysisFilterError, parseCoverageFilters, parseSalesFilters } from "@/lib/commercial-analysis/filters";
import {
  currentWeekParam,
  formatDayFr,
  mondayOf,
  monthRange,
  normalizeWeekParam,
  recentMonths,
  shiftWeek,
  weekRange,
} from "@/lib/commercial-analysis/period";
import {
  buildDriverRows,
  buildProductRows,
  buildTotals,
  sortProductRows,
  type ProductMeta,
  type SalesAggregateRow,
} from "@/lib/commercial-analysis/sales-analysis";
import type { CoverageCustomerRow, CoverageDriverRow } from "@/types/commercial-analysis";

const row = (overrides: Partial<SalesAggregateRow>): SalesAggregateRow => ({
  driverId: "d1",
  productId: "p1",
  soldQuantity: 0,
  soldRevenue: 0,
  soldCost: 0,
  returnedQuantity: 0,
  returnedRevenue: 0,
  returnedCost: 0,
  ...overrides,
});

const meta = new Map<string, ProductMeta>([
  ["p1", { name: "Eau 1,5 L", reference: "EAU15", supplierId: "s1", supplierName: "Sidi Ali" }],
  ["p2", { name: "Jus orange", reference: "JUS01", supplierId: "s2", supplierName: "Jus SA" }],
  ["p3", { name: "Soda", reference: "SOD01", supplierId: null, supplierName: null }],
]);

describe("sales analysis - aggregation", () => {
  it("merges several groups of the same product into ONE row", () => {
    const rows = [
      row({ driverId: "d1", productId: "p1", soldQuantity: 10, soldRevenue: 100, soldCost: 60 }),
      row({ driverId: "d2", productId: "p1", soldQuantity: 5, soldRevenue: 55, soldCost: 30 }),
    ];
    const products = buildProductRows(rows, meta);
    assert.equal(products.length, 1);
    assert.deepEqual(
      { quantity: products[0].quantity, revenue: products[0].revenue, margin: products[0].margin },
      { quantity: 15, revenue: 155, margin: 65 },
    );
    assert.equal(products[0].supplierName, "Sidi Ali");
  });

  it("filters on one driver without touching the other drivers' figures", () => {
    const rows = [
      row({ driverId: "d1", productId: "p1", soldQuantity: 10, soldRevenue: 100, soldCost: 60 }),
      row({ driverId: "d2", productId: "p1", soldQuantity: 5, soldRevenue: 55, soldCost: 30 }),
    ];
    assert.equal(buildProductRows(rows, meta, { driverId: "d2" })[0].quantity, 5);
    assert.equal(buildTotals(rows, { driverId: "d2" }).revenue, 55);
    assert.equal(buildTotals(rows, { driverId: "all" }).revenue, 155);
  });

  it("nets returns / credit notes from quantity, revenue and margin (cost of the returned goods comes back)", () => {
    const rows = [
      row({
        soldQuantity: 10,
        soldRevenue: 200,
        soldCost: 120,
        returnedQuantity: 2,
        returnedRevenue: 40,
        returnedCost: 24,
      }),
    ];
    const totals = buildTotals(rows);
    assert.equal(totals.quantity, 8);
    assert.equal(totals.revenue, 160);
    // (200 - 120) - (40 - 24) = 64 = 160 revenue - 96 cost
    assert.equal(totals.margin, 64);
  });

  it("a return without a known cost lowers revenue and margin by its revenue", () => {
    const totals = buildTotals([
      row({ soldQuantity: 10, soldRevenue: 200, soldCost: 120, returnedQuantity: 1, returnedRevenue: 20, returnedCost: 0 }),
    ]);
    assert.equal(totals.revenue, 180);
    assert.equal(totals.margin, 60);
  });

  it("uses the revenue after discount (totalHT) and the frozen cost: revenue and margin stay consistent", () => {
    // 10 x 12 HT list price, 10 % discount -> totalHT 108 ; frozen cost 10 x 8 = 80
    const totals = buildTotals([row({ soldQuantity: 10, soldRevenue: 108, soldCost: 80 })]);
    assert.equal(totals.revenue, 108);
    assert.equal(totals.margin, 28);
    assert.equal(totals.revenue - totals.margin, 80);
  });

  it("counts distinct products sold, not lines, and not products that only have returns", () => {
    const rows = [
      row({ productId: "p1", soldQuantity: 3, soldRevenue: 30 }),
      row({ driverId: "d2", productId: "p1", soldQuantity: 2, soldRevenue: 20 }),
      row({ productId: "p2", soldQuantity: 1, soldRevenue: 9 }),
      row({ productId: "p3", returnedQuantity: 1, returnedRevenue: 5 }),
    ];
    assert.equal(buildTotals(rows).distinctProducts, 2);
  });

  it("rounds money to cents only at the end (no drift from many small lines)", () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      row({ driverId: `d${index}`, soldQuantity: 1, soldRevenue: 0.1, soldCost: 0.05 }),
    );
    const totals = buildTotals(rows);
    assert.equal(totals.revenue, 10);
    assert.equal(totals.margin, 5);
  });

  it("returns a clean empty result (zeros, no NaN) without any row", () => {
    assert.deepEqual(buildTotals([]), { quantity: 0, revenue: 0, margin: 0, distinctProducts: 0 });
    assert.deepEqual(buildProductRows([], meta), []);
    assert.deepEqual(buildDriverRows([], new Map()), []);
  });

  it("builds the comparative view per driver without mixing the drivers", () => {
    const rows = [
      row({ driverId: "d1", productId: "p1", soldQuantity: 10, soldRevenue: 100, soldCost: 60 }),
      row({ driverId: "d1", productId: "p2", soldQuantity: 4, soldRevenue: 40, soldCost: 30 }),
      row({ driverId: "d2", productId: "p1", soldQuantity: 5, soldRevenue: 55, soldCost: 30 }),
    ];
    const drivers = buildDriverRows(
      rows,
      new Map([
        ["d1", "Karim"],
        ["d2", "Said"],
      ]),
    );
    const d1 = drivers.find((driver) => driver.driverId === "d1")!;
    const d2 = drivers.find((driver) => driver.driverId === "d2")!;
    assert.deepEqual([d1.quantity, d1.revenue, d1.margin, d1.productCount], [14, 140, 50, 2]);
    assert.deepEqual([d2.quantity, d2.revenue, d2.margin, d2.productCount], [5, 55, 25, 1]);
    // The per-driver rows add up to the "all drivers" totals.
    assert.equal(d1.revenue + d2.revenue, buildTotals(rows).revenue);
  });
});

describe("sales analysis - sorting", () => {
  const products = buildProductRows(
    [
      row({ productId: "p1", soldQuantity: 10, soldRevenue: 100, soldCost: 90 }),
      row({ productId: "p2", soldQuantity: 4, soldRevenue: 200, soldCost: 100 }),
      row({ productId: "p3", soldQuantity: 7, soldRevenue: 50, soldCost: 10 }),
    ],
    meta,
  );

  it("sorts by quantity, revenue and margin, ascending and descending", () => {
    assert.deepEqual(sortProductRows(products, "quantity", "desc").map((p) => p.productId), ["p1", "p3", "p2"]);
    assert.deepEqual(sortProductRows(products, "quantity", "asc").map((p) => p.productId), ["p2", "p3", "p1"]);
    assert.deepEqual(sortProductRows(products, "revenue", "desc").map((p) => p.productId), ["p2", "p1", "p3"]);
    assert.deepEqual(sortProductRows(products, "margin", "desc").map((p) => p.productId), ["p2", "p3", "p1"]);
    assert.deepEqual(sortProductRows(products, "margin", "asc").map((p) => p.productId), ["p1", "p3", "p2"]);
  });

  it("breaks ties by name so the order is stable", () => {
    const tied = buildProductRows(
      [row({ productId: "p2", soldQuantity: 5 }), row({ productId: "p1", soldQuantity: 5 })],
      meta,
    );
    assert.deepEqual(sortProductRows(tied, "quantity", "desc").map((p) => p.productId), ["p1", "p2"]);
  });
});

describe("coverage - rate", () => {
  it("50 assigned customers and 40 buyers = 80 %", () => {
    assert.equal(coverageRate(50, 40), 80);
    assert.deepEqual(summarize(50, 40), { assigned: 50, buyers: 40, withoutPurchase: 10, rate: 80 });
  });

  it("everybody buys = 100 %, nobody buys = 0 %", () => {
    assert.equal(summarize(12, 12).rate, 100);
    assert.deepEqual(summarize(12, 0), { assigned: 12, buyers: 0, withoutPurchase: 12, rate: 0 });
  });

  it("nobody assigned -> no rate (null), no division by zero", () => {
    assert.equal(coverageRate(0, 0), null);
    assert.deepEqual(summarize(0, 0), { assigned: 0, buyers: 0, withoutPurchase: 0, rate: null });
  });

  it("keeps one decimal and never exceeds the portfolio", () => {
    assert.equal(coverageRate(3, 1), 33.3);
    assert.equal(summarize(5, 9).buyers, 5);
    assert.equal(summarize(5, 9).rate, 100);
  });
});

describe("coverage - customer rows", () => {
  const portfolio = [
    { customerId: "c2", name: "Epicerie Atlas" },
    { customerId: "c1", name: "Café Zahra" },
    { customerId: "c3", name: "Boulangerie" },
  ];

  it("counts a customer ONCE however many sales it made, and lists the whole portfolio", () => {
    const rows = buildCustomerRows(
      portfolio,
      new Map([["c1", { customerId: "c1", salesCount: 4, amount: 1234.567, lastPurchaseAt: new Date("2026-10-08T10:00:00Z") }]]),
    );
    assert.equal(rows.length, 3);
    const cafe = rows.find((r) => r.customerId === "c1")!;
    assert.deepEqual([cafe.status, cafe.salesCount, cafe.amount, cafe.lastPurchaseAt], ["BOUGHT", 4, 1234.57, "2026-10-08T10:00:00.000Z"]);
    assert.deepEqual(summarizeCustomerRows(rows), { assigned: 3, buyers: 1, withoutPurchase: 2, rate: 33.3 });
  });

  it("a customer with no purchase has no amount and no date; purchases of customers outside the portfolio are ignored", () => {
    const rows = buildCustomerRows(
      portfolio,
      new Map([["stranger", { customerId: "stranger", salesCount: 2, amount: 50, lastPurchaseAt: new Date() }]]),
    );
    assert.ok(rows.every((r) => r.status === "NO_PURCHASE" && r.salesCount === 0 && r.amount === 0 && r.lastPurchaseAt === null));
    assert.equal(summarizeCustomerRows(rows).buyers, 0);
  });

  it("sorts by name (French collation) and gives the empty portfolio an empty list", () => {
    assert.deepEqual(buildCustomerRows(portfolio, new Map()).map((r) => r.name), ["Boulangerie", "Café Zahra", "Epicerie Atlas"]);
    assert.deepEqual(buildCustomerRows([], new Map()), []);
    assert.equal(summarizeCustomerRows([] as CoverageCustomerRow[]).rate, null);
  });
});

describe("coverage - driver comparison sort", () => {
  const drivers: CoverageDriverRow[] = [
    { driverId: "a", driverName: "Karim", assigned: 50, buyers: 40, withoutPurchase: 10, rate: 80 },
    { driverId: "b", driverName: "Said", assigned: 20, buyers: 5, withoutPurchase: 15, rate: 25 },
    { driverId: "c", driverName: "Omar", assigned: 0, buyers: 0, withoutPurchase: 0, rate: null },
    { driverId: "d", driverName: "Ali", assigned: 10, buyers: 10, withoutPurchase: 0, rate: 100 },
  ];

  it("sorts by rate, buyers and without-purchase; drivers with no portfolio always go last", () => {
    assert.deepEqual(sortCoverageDrivers(drivers, "rate", "desc").map((d) => d.driverId), ["d", "a", "b", "c"]);
    assert.deepEqual(sortCoverageDrivers(drivers, "rate", "asc").map((d) => d.driverId), ["b", "a", "d", "c"]);
    assert.deepEqual(sortCoverageDrivers(drivers, "buyers", "desc").map((d) => d.driverId)[0], "a");
    assert.deepEqual(sortCoverageDrivers(drivers, "withoutPurchase", "desc").map((d) => d.driverId)[0], "b");
  });
});

describe("periods", () => {
  it("a month is [1st 02:00, next 1st 02:00[ in the business-day convention", () => {
    const september = monthRange("2026-09");
    assert.equal(september.fromDay, "2026-09-01");
    assert.equal(september.toDay, "2026-09-30");
    assert.equal(monthRange("2026-10").start.getTime(), september.end.getTime());
    // 02:00 local (UTC+1 in September) = 01:00 UTC
    assert.equal(september.start.toISOString(), "2026-09-01T01:00:00.000Z");
  });

  it("handles December -> January and February of a leap year", () => {
    assert.equal(monthRange("2026-12").end.getTime(), monthRange("2027-01").start.getTime());
    assert.equal(monthRange("2028-02").toDay, "2028-02-29");
    assert.equal(monthRange("2027-02").toDay, "2027-02-28");
  });

  it("rejects an invalid month", () => {
    assert.throws(() => monthRange("2026-13"), RangeError);
    assert.throws(() => monthRange("septembre"), RangeError);
  });

  it("a week is Monday -> Sunday and any day of it is normalised to the Monday", () => {
    assert.equal(mondayOf("2026-09-07"), "2026-09-07"); // Monday
    assert.equal(mondayOf("2026-09-13"), "2026-09-07"); // Sunday
    assert.equal(mondayOf("2026-09-09"), "2026-09-07");
    assert.equal(normalizeWeekParam("2026-09-10"), "2026-09-07");
    const week = weekRange("2026-09-10");
    assert.equal(week.fromDay, "2026-09-07");
    assert.equal(week.toDay, "2026-09-13");
    assert.equal(week.end.getTime() - week.start.getTime(), 7 * 24 * 3600 * 1000);
  });

  it("consecutive weeks are contiguous (no sale falls between two weeks nor in both)", () => {
    const previous = weekRange(shiftWeek("2026-09-07", -1));
    const current = weekRange("2026-09-07");
    assert.equal(previous.end.getTime(), current.start.getTime());
    assert.equal(previous.fromDay, "2026-08-31");
    assert.equal(formatDayFr(current.toDay), "13/09/2026");
  });

  it("the current week follows the business day: Monday 01:00 still belongs to the previous week", () => {
    // 2026-10-12 is a Monday. 00:30 Casablanca (UTC+1) = 23:30Z on the 11th -> business day Sunday 11th.
    assert.equal(currentWeekParam(new Date("2026-10-11T23:30:00Z")), "2026-10-05");
    assert.equal(currentWeekParam(new Date("2026-10-12T10:00:00Z")), "2026-10-12");
  });

  it("recentMonths lists the current month first, newest to oldest, across a year boundary", () => {
    const months = recentMonths(3, new Date("2026-01-15T10:00:00Z")).map((m) => m.value);
    assert.deepEqual(months, ["2026-01", "2025-12", "2025-11"]);
    assert.equal(recentMonths(1, new Date("2026-09-15T10:00:00Z"))[0].label, "septembre 2026");
  });
});

describe("filters validation", () => {
  const params = (init: Record<string, string>) => new URLSearchParams(init);
  const now = new Date("2026-10-12T10:00:00Z");

  it("takes the defaults when nothing is given", () => {
    assert.deepEqual(parseSalesFilters(params({}), now), {
      driverId: "all",
      month: "2026-10",
      supplierId: "all",
      metric: "revenue",
      sort: "revenue",
      direction: "desc",
    });
    assert.deepEqual(parseCoverageFilters(params({}), now), { driverId: "all", week: "2026-10-12" });
  });

  it("accepts the combined filters driver + month + supplier + metric + sort", () => {
    const filters = parseSalesFilters(
      params({ driverId: "drv_1", month: "2026-09", supplierId: "sup_2", metric: "margin", sort: "quantity", direction: "asc" }),
      now,
    );
    assert.deepEqual(filters, { driverId: "drv_1", month: "2026-09", supplierId: "sup_2", metric: "margin", sort: "quantity", direction: "asc" });
    assert.equal(parseSalesFilters(params({ supplierId: "none" }), now).supplierId, "none");
    // The sort follows the chosen metric unless asked otherwise.
    assert.equal(parseSalesFilters(params({ metric: "quantity" }), now).sort, "quantity");
  });

  it("refuses invalid values with the offending field instead of silently changing them", () => {
    const fails = (init: Record<string, string>, field: string, parse: typeof parseSalesFilters | typeof parseCoverageFilters = parseSalesFilters) =>
      assert.throws(
        () => parse(params(init), now),
        (error: unknown) => error instanceof AnalysisFilterError && error.field === field,
      );
    fails({ month: "2026-13" }, "month");
    fails({ month: "09/2026" }, "month");
    fails({ metric: "profit" }, "metric");
    fails({ sort: "name" }, "sort");
    fails({ direction: "up" }, "direction");
    fails({ driverId: "x'; DROP TABLE" }, "driverId");
    fails({ supplierId: "a b" }, "supplierId");
    fails({ week: "2026-02-30" }, "week", parseCoverageFilters);
    fails({ week: "lundi" }, "week", parseCoverageFilters);
    fails({ driverId: "../etc" }, "driverId", parseCoverageFilters);
  });

  it("normalises any day of the week to its Monday", () => {
    assert.equal(parseCoverageFilters(params({ week: "2026-09-10" }), now).week, "2026-09-07");
  });
});

describe("access", () => {
  it("only the administrator sees the commercial analysis", () => {
    assert.equal(canViewCommercialAnalysis("admin"), true);
    for (const role of ["cashier", "driver", "manager", "", null, undefined]) {
      assert.equal(canViewCommercialAnalysis(role as Parameters<typeof canViewCommercialAnalysis>[0]), false, String(role));
    }
  });
});
