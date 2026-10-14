import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DAILY_INVOICES_PATH,
  DAILY_SALES_GROUPING_PATH,
  dailyFiltersFromQuery,
  dailyFiltersToQuery,
  dailyInvoicesHref,
  dailyParamsFromSearchParams,
  dailySalesGroupingHref,
  toURLSearchParams,
} from "@/lib/daily-invoices-filters";

/** One filter representation (the URL query) for « Factures journalières » and « Regroupement des ventes ». */

const filters = { day: "2026-10-14", userIds: ["u-driver-1", "u-cashier"], paymentMethod: "CREDIT" };

test("navigation: the grouping page opens with the filters of the daily invoices page, and « Retour » brings them back", () => {
  assert.equal(dailySalesGroupingHref(filters), `${DAILY_SALES_GROUPING_PATH}?day=2026-10-14&userIds=u-driver-1%2Cu-cashier&paymentMethod=CREDIT`);
  assert.equal(dailyInvoicesHref(filters), `${DAILY_INVOICES_PATH}?day=2026-10-14&userIds=u-driver-1%2Cu-cashier&paymentMethod=CREDIT`);
  // round trip: what one page writes, the other reads back identically
  const back = new URL(dailyInvoicesHref(filters), "https://app.test").searchParams;
  assert.deepEqual(dailyFiltersFromQuery(back, "2026-10-14"), filters);
});

test("defaults are not written: every user and every method = only the day", () => {
  assert.equal(dailyFiltersToQuery({ day: "2026-10-14", userIds: [], paymentMethod: "all" }), "day=2026-10-14");
  assert.equal(dailySalesGroupingHref({ day: "", userIds: [], paymentMethod: "all" }), DAILY_SALES_GROUPING_PATH);
});

test("reading a query: unknown payment method -> all, duplicates and blanks removed, a Next searchParams record accepted", () => {
  const record = { day: "2026-10-14", userIds: "a, b,,a", paymentMethod: "BITCOIN" };
  assert.deepEqual(dailyFiltersFromQuery(record, "2026-10-14"), { day: "2026-10-14", userIds: ["a", "b"], paymentMethod: "all" });
  assert.equal(toURLSearchParams({ day: ["2026-10-13", "2026-10-14"], x: undefined }).toString(), "day=2026-10-13", "first value of a repeated key");
});

test("the server reads the very same query (same parameters as GET /api/daily-invoices)", () => {
  const params = dailyParamsFromSearchParams(new URLSearchParams(dailyFiltersToQuery(filters)));
  assert.deepEqual({ day: params.day, userIds: params.userIds, paymentMethod: params.paymentMethod }, { day: "2026-10-14", userIds: ["u-driver-1", "u-cashier"], paymentMethod: "CREDIT" });
});
