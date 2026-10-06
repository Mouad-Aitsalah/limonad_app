import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import Decimal from "decimal.js-light";

import { formatCurrency } from "@/lib/currency";
import { DASHBOARD_AMOUNT_ROUNDING, formatDashboardAmount } from "@/lib/dashboard-format";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
// the currency formatter separates the figure and "DH" with a no-break space
const plain = (value: string) => value.replace(/[  ]/g, " ");

// ---- the figures of the brief --------------------------------------------------------

test("Dashboard KPI amounts lose their decimals: the examples of the brief", () => {
  const cases: Array<[number, string]> = [
    [14718.5, "14.718 DH"],
    [1260.78, "1.261 DH"],
    [11767.39, "11.767 DH"],
    [1548698.94, "1.548.699 DH"],
    [474.79, "475 DH"],
    [0, "0 DH"],
  ];
  for (const [value, expected] of cases) assert.equal(plain(formatDashboardAmount(value)), expected, String(value));
});

test("rounding to the nearest integer: 339,49 -> 339, 339,50 / 339,75 / 339,98 / 340,24 / 340,25 -> 340", () => {
  const cases: Array<[number, string]> = [
    [339.49, "339 DH"],
    [339.5, "340 DH"],
    [339.75, "340 DH"],
    [339.98, "340 DH"],
    [340.24, "340 DH"],
    [340.25, "340 DH"],
  ];
  for (const [value, expected] of cases) assert.equal(plain(formatDashboardAmount(value)), expected, String(value));
});

test("an amount exactly between two integers goes to the even one - the only rule that fits both 339,50 -> 340 and 14.718,50 -> 14.718", () => {
  assert.equal(DASHBOARD_AMOUNT_ROUNDING, Decimal.ROUND_HALF_EVEN);
  assert.equal(plain(formatDashboardAmount(339.5)), "340 DH");
  assert.equal(plain(formatDashboardAmount(14718.5)), "14.718 DH");
  assert.equal(plain(formatDashboardAmount(0.5)), "0 DH");
  assert.equal(plain(formatDashboardAmount(1.5)), "2 DH");
  assert.equal(plain(formatDashboardAmount(2.5)), "2 DH");
  assert.equal(plain(formatDashboardAmount(-339.5)), "-340 DH");
  assert.equal(plain(formatDashboardAmount(-14718.5)), "-14.718 DH");
});

test("never a decimal, never '-0', same unit and separators as the rest of the application", () => {
  for (const value of [0, 0.4, -0.4, 1, 9.99, 1000.01, 123456.78, 1548698.94, -1548698.94, 1e9 + 0.4]) {
    assert.equal(/[,]\d/.test(formatDashboardAmount(value)), false, `${value}: ${formatDashboardAmount(value)}`);
  }
  assert.equal(plain(formatDashboardAmount(-0.4)), "0 DH");
  assert.equal(plain(formatDashboardAmount(-0)), "0 DH");
  assert.equal(plain(formatDashboardAmount(-1548698.94)), "-1.548.699 DH");
  assert.match(formatDashboardAmount(1234), /^1\.234\s?DH$/);
});

test("a string or a non-finite value is handled like the standard formatter does", () => {
  assert.equal(plain(formatDashboardAmount("1260.78")), "1.261 DH");
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "abc"]) assert.equal(formatDashboardAmount(bad), "0 DH");
});

// ---- the display rounding stays on the Dashboard KPI cards ---------------------------

test("the application-wide formatter is untouched: two decimals everywhere else", () => {
  assert.equal(plain(formatCurrency(14718.5)), "14.718,50 DH");
  assert.equal(plain(formatCurrency(1260.78)), "1.260,78 DH");
  assert.equal(plain(formatCurrency(339.5)), "339,50 DH");
  assert.equal(plain(formatCurrency(0)), "0,00 DH");
  const currency = read("lib/currency.ts");
  assert.equal(/dashboard|formatDashboardAmount/i.test(currency), false, "lib/currency.ts knows nothing about the dashboard");
  assert.match(currency, /minimumFractionDigits: 2,\s*maximumFractionDigits: 2,/);
});

test("only the Dashboard KPI shaper imports formatDashboardAmount - nothing else in the application", () => {
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".next", "generated", "mobile", ".git"].includes(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && /from "@\/lib\/dashboard-format"/.test(readFileSync(full, "utf8"))) {
        importers.push(path.relative(process.cwd(), full).replaceAll("\\", "/"));
      }
    }
  };
  for (const dir of ["lib", "components", "app", "types"]) walk(path.join(process.cwd(), dir));
  assert.deepEqual(importers.sort(), ["lib/server/dashboard-direction.ts"]);
});

test("the shaper: the 8 money KPIs are in whole dirhams; counts, trends and every other block keep their format", () => {
  const server = read("lib/server/dashboard-direction.ts");
  // money KPI constructor + receivables + stock value: exactly these three call sites
  assert.equal((server.match(/formatDashboardAmount\(/g) ?? []).length, 3);
  assert.match(server, /value: formatDashboardAmount\(current\), trend: buildTrend\(current, previous\)/);
  assert.match(server, /value: formatDashboardAmount\(receivables\),/);
  assert.match(server, /value: formatDashboardAmount\(stockValue\.value\),/);
  // the eight money KPIs go through them
  for (const id of ["revenue", "gross-margin", "estimated-result", "avg-basket", "purchases-ht", "charges-ht"]) {
    assert.match(server, new RegExp(`moneyKpi\\("${id}"`), id);
  }
  // counts stay plain integers, percentages keep their decimal
  assert.match(server, /value: current\.toLocaleString\("fr-FR"\),/);
  assert.match(server, /maximumFractionDigits: 1/);
  // the tables and the watchlist still show cents
  assert.match(server, /ca: formatCurrency\(row\.ca\)/);
  assert.match(server, /margin: formatCurrency\(row\.margin\)/);
  assert.match(server, /ca: formatCurrency\(customer\.ca\)/);
  assert.match(server, /receivable: formatCurrency\(debt\.debt\)/);
  assert.match(server, /label: `\$\{formatCurrency\(receivables\)\} de creances clients`/);
  // no calculation touched: the same BI helpers feed the same numbers
  for (const helper of ["revenue(", "grossMarginHT(", "estimatedResult(", "customerReceivables(", "stockValueAtCost(", "avgBasket(", "purchasesHT(", "totalCharges("]) {
    assert.ok(server.includes(helper), helper);
  }
});
