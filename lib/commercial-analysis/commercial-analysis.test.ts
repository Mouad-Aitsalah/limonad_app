import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCustomerRows,
  coverageRate,
  sortCoverageUsers,
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
  buildProductRows,
  buildTotals,
  buildUserRows,
  PRODUCTS_PREVIEW_COUNT,
  selectRows,
  sortProductRows,
  visibleProductRows,
  type ProductMeta,
  type SalesAggregateRow,
} from "@/lib/commercial-analysis/sales-analysis";
import { MAX_SELECTION } from "@/lib/commercial-analysis/filters";
import { NO_SUPPLIER, UNASSIGNED, type CoverageCustomerRow, type CoverageUserRow } from "@/types/commercial-analysis";

const row = (overrides: Partial<SalesAggregateRow>): SalesAggregateRow => ({
  userId: "u1",
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
      row({ userId: "u1", productId: "p1", soldQuantity: 10, soldRevenue: 100, soldCost: 60 }),
      row({ userId: "u2", productId: "p1", soldQuantity: 5, soldRevenue: 55, soldCost: 30 }),
    ];
    const products = buildProductRows(rows, meta);
    assert.equal(products.length, 1);
    assert.deepEqual(
      { quantity: products[0].quantity, revenue: products[0].revenue, margin: products[0].margin },
      { quantity: 15, revenue: 155, margin: 65 },
    );
    assert.equal(products[0].supplierName, "Sidi Ali");
  });

  it("filters on one user without touching the other users' figures", () => {
    const rows = [
      row({ userId: "u1", productId: "p1", soldQuantity: 10, soldRevenue: 100, soldCost: 60 }),
      row({ userId: "u2", productId: "p1", soldQuantity: 5, soldRevenue: 55, soldCost: 30 }),
    ];
    assert.equal(buildProductRows(rows, meta, { userIds: ["u2"] })[0].quantity, 5);
    assert.equal(buildTotals(rows, { userIds: ["u2"] }).revenue, 55);
    assert.equal(buildTotals(rows, { userIds: [] }).revenue, 155);
  });

  it("two selected users are CUMULATED: union of their groups, each sale counted once", () => {
    const rows = [
      row({ userId: "u1", productId: "p1", soldQuantity: 10, soldRevenue: 100, soldCost: 60 }),
      row({ userId: "u2", productId: "p1", soldQuantity: 5, soldRevenue: 55, soldCost: 30 }),
      row({ userId: "u2", productId: "p2", soldQuantity: 2, soldRevenue: 20, soldCost: 12 }),
      row({ userId: "u3", productId: "p1", soldQuantity: 7, soldRevenue: 70, soldCost: 40 }),
    ];
    const both = buildTotals(rows, { userIds: ["u1", "u2"] });
    assert.deepEqual(both, { quantity: 17, revenue: 175, margin: 73, distinctProducts: 2 });
    // = u1 alone + u2 alone (disjoint: a group belongs to ONE seller)
    const u1 = buildTotals(rows, { userIds: ["u1"] });
    const u2 = buildTotals(rows, { userIds: ["u2"] });
    assert.equal(both.revenue, u1.revenue + u2.revenue);
    // a user selected twice is not counted twice
    assert.deepEqual(buildTotals(rows, { userIds: ["u1", "u1", "u2"] }), both);
    // the product row merges the selected users only
    const p1 = buildProductRows(rows, meta, { userIds: ["u1", "u2"] }).find((product) => product.productId === "p1")!;
    assert.equal(p1.quantity, 15);
    // every user selected = no selection
    assert.deepEqual(buildTotals(rows, { userIds: ["u1", "u2", "u3"] }), buildTotals(rows));
    assert.equal(selectRows(rows, { userIds: ["nobody"] }).length, 0);
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
      row({ userId: "u2", productId: "p1", soldQuantity: 2, soldRevenue: 20 }),
      row({ productId: "p2", soldQuantity: 1, soldRevenue: 9 }),
      row({ productId: "p3", returnedQuantity: 1, returnedRevenue: 5 }),
    ];
    assert.equal(buildTotals(rows).distinctProducts, 2);
  });

  it("rounds money to cents only at the end (no drift from many small lines)", () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      row({ userId: `u${index}`, soldQuantity: 1, soldRevenue: 0.1, soldCost: 0.05 }),
    );
    const totals = buildTotals(rows);
    assert.equal(totals.revenue, 10);
    assert.equal(totals.margin, 5);
  });

  it("returns a clean empty result (zeros, no NaN) without any row", () => {
    assert.deepEqual(buildTotals([]), { quantity: 0, revenue: 0, margin: 0, distinctProducts: 0 });
    assert.deepEqual(buildProductRows([], meta), []);
    assert.deepEqual(buildUserRows([], new Map()), []);
  });

  it("builds the comparative view per user without mixing the users", () => {
    const rows = [
      row({ userId: "u1", productId: "p1", soldQuantity: 10, soldRevenue: 100, soldCost: 60 }),
      row({ userId: "u1", productId: "p2", soldQuantity: 4, soldRevenue: 40, soldCost: 30 }),
      row({ userId: "u2", productId: "p1", soldQuantity: 5, soldRevenue: 55, soldCost: 30 }),
    ];
    const users = buildUserRows(
      rows,
      new Map([
        ["u1", "Karim"],
        ["u2", "Said"],
      ]),
    );
    const d1 = users.find((user) => user.userId === "u1")!;
    const d2 = users.find((user) => user.userId === "u2")!;
    assert.equal(d1.userName, "Karim");
    assert.deepEqual(buildUserRows(rows, new Map(), { userIds: ["u2"] }).map((user) => user.userId), ["u2"]);
    assert.deepEqual([d1.quantity, d1.revenue, d1.margin, d1.productCount], [14, 140, 50, 2]);
    assert.deepEqual([d2.quantity, d2.revenue, d2.margin, d2.productCount], [5, 55, 25, 1]);
    // The per-user rows add up to the "all users" totals.
    assert.equal(d1.revenue + d2.revenue, buildTotals(rows).revenue);
  });
});

describe("sales analysis - « Produits vendus » preview", () => {
  const ten = Array.from({ length: 10 }, (_, index) => ({ id: index }));

  it("shows the first 4 rows (in the ranking order) and says how many are hidden", () => {
    assert.equal(PRODUCTS_PREVIEW_COUNT, 4);
    const preview = visibleProductRows(ten, false);
    assert.deepEqual(preview.rows.map((row) => row.id), [0, 1, 2, 3]);
    assert.equal(preview.hiddenCount, 6);
  });

  it("« Voir tous les produits » shows every row; « Réduire » goes back to 4 - from the same rows, nothing reloaded", () => {
    assert.equal(visibleProductRows(ten, true).rows.length, 10);
    assert.equal(visibleProductRows(ten, true).hiddenCount, 0);
    assert.equal(visibleProductRows(ten, false).rows.length, 4);
  });

  it("4 rows or fewer: everything is shown, nothing to expand", () => {
    assert.deepEqual(visibleProductRows(ten.slice(0, 4), false), { rows: ten.slice(0, 4), hiddenCount: 0 });
    assert.deepEqual(visibleProductRows([], false), { rows: [], hiddenCount: 0 });
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

  it("carries the owner of each customer; no owner = « Non attribué » (null)", () => {
    const rows = buildCustomerRows(
      [
        { customerId: "c1", name: "A", ownerName: "Karim" },
        { customerId: "c2", name: "B", ownerName: null },
        { customerId: "c3", name: "C" },
      ],
      new Map(),
    );
    assert.deepEqual(rows.map((r) => r.ownerName), ["Karim", null, null]);
  });

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

describe("coverage - user comparison sort", () => {
  const users: CoverageUserRow[] = [
    { userId: "a", userName: "Karim", assigned: 50, buyers: 40, withoutPurchase: 10, rate: 80 },
    { userId: "b", userName: "Said", assigned: 20, buyers: 5, withoutPurchase: 15, rate: 25 },
    { userId: "c", userName: "Omar", assigned: 0, buyers: 0, withoutPurchase: 0, rate: null },
    { userId: "d", userName: "Ali", assigned: 10, buyers: 10, withoutPurchase: 0, rate: 100 },
  ];

  it("sorts by rate, buyers and without-purchase; users with no portfolio always go last", () => {
    assert.deepEqual(sortCoverageUsers(users, "rate", "desc").map((d) => d.userId), ["d", "a", "b", "c"]);
    assert.deepEqual(sortCoverageUsers(users, "rate", "asc").map((d) => d.userId), ["b", "a", "d", "c"]);
    assert.deepEqual(sortCoverageUsers(users, "buyers", "desc").map((d) => d.userId)[0], "a");
    assert.deepEqual(sortCoverageUsers(users, "withoutPurchase", "desc").map((d) => d.userId)[0], "b");
  });

  it("the summary of several portfolios is their sum (a customer is in one portfolio at most)", () => {
    const union = summarize(50 + 20, 40 + 5);
    assert.deepEqual(union, { assigned: 70, buyers: 45, withoutPurchase: 25, rate: 64.3 });
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
      userIds: [],
      month: "2026-10",
      supplierIds: [],
      metric: "revenue",
      sort: "revenue",
      direction: "desc",
    });
    assert.deepEqual(parseCoverageFilters(params({}), now), { userIds: [], week: "2026-10-12" });
  });

  it("accepts the combined filters users + month + suppliers + metric + sort", () => {
    const filters = parseSalesFilters(
      params({ userIds: "usr_1,usr_2", month: "2026-09", supplierIds: "sup_2,none", metric: "margin", sort: "quantity", direction: "asc" }),
      now,
    );
    assert.deepEqual(filters, {
      userIds: ["usr_1", "usr_2"],
      month: "2026-09",
      supplierIds: ["sup_2", NO_SUPPLIER],
      metric: "margin",
      sort: "quantity",
      direction: "asc",
    });
    assert.deepEqual(parseSalesFilters(params({ supplierIds: "none" }), now).supplierIds, [NO_SUPPLIER]);
    // The sort follows the chosen metric unless asked otherwise.
    assert.equal(parseSalesFilters(params({ metric: "quantity" }), now).sort, "quantity");
  });

  it("multiple selections: repeats removed, blanks ignored, empty = everything", () => {
    assert.deepEqual(parseSalesFilters(params({ userIds: "a,b,a, ,b" }), now).userIds, ["a", "b"]);
    assert.deepEqual(parseSalesFilters(params({ userIds: "" }), now).userIds, []);
    assert.deepEqual(parseCoverageFilters(params({ userIds: `u1,${UNASSIGNED}` }), now).userIds, ["u1", UNASSIGNED]);
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
    fails({ userIds: "x'; DROP TABLE" }, "userIds");
    fails({ userIds: "ok,a b" }, "userIds");
    fails({ supplierIds: "a b" }, "supplierIds");
    fails({ supplierIds: UNASSIGNED + "!" }, "supplierIds");
    fails({ userIds: Array.from({ length: MAX_SELECTION + 1 }, (_, i) => `u${i}`).join(",") }, "userIds");
    fails({ week: "2026-02-30" }, "week", parseCoverageFilters);
    fails({ week: "lundi" }, "week", parseCoverageFilters);
    fails({ userIds: "../etc" }, "userIds", parseCoverageFilters);
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
