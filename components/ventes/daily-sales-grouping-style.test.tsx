import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SalesGroupingReport } from "@/components/ventes/daily-sales-grouping-view";
import type { DailySalesGroupingDto, DailySalesProductDto } from "@/types/daily-invoice";

/** « Regroupement des ventes »: sober look - white rows, ONE accent colour on the product name only. */

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function product(id: string, name: string): DailySalesProductDto {
  return {
    productId: id,
    name,
    reference: `R-${id}`,
    priceGroups: [
      { unitPriceTTC: 20, quantity: 3, amountTTC: 60, margin: { marginHT: 12.5, revenueHT: 50, markupRate: 25, partial: false, totalRevenueHT: 50, excludedRevenueHT: 0, missingCostLines: 0, approximateCostLines: 0 } },
    ],
    totalQuantity: 3,
    totalTTC: 60,
    margin: { marginHT: 12.5, revenueHT: 50, markupRate: 25, partial: false, totalRevenueHT: 50, excludedRevenueHT: 0, missingCostLines: 0, approximateCostLines: 0 },
  };
}

const products = ["Aquafina1.5", "Aquafina mini 33", "1/2L هواي", "Sidi Ali"].map((name, index) => product(`p${index}`, name));
const data: DailySalesGroupingDto = {
  day: "2026-10-14",
  dayLabel: "14/10/2026",
  invoiceCount: 1,
  products,
  totals: { productCount: 4, totalQuantity: 12, linesTotalTTC: 240, roundingTotal: 0, revenueTotal: 240, reconciliationGap: 0, reconciled: true },
  margin: products[0].margin,
  userOptions: [],
};

test("no coloured background or border on the groups: rows stay white / neutral", () => {
  const markup = renderToStaticMarkup(createElement(SalesGroupingReport, { data }));
  const table = markup.slice(markup.indexOf("<table"), markup.indexOf("</table>"));
  const body = table.slice(table.indexOf("<tbody"));
  assert.equal(/bg-(?:sky|emerald|violet|amber|rose|teal|indigo|lime|yellow|green|purple|pink|cyan|blue)-\d+/.test(body), false, "no pastel background");
  assert.equal(/bg-muted/.test(body), false, "no filled subtotal row");
  assert.equal(/data-tint/.test(body), false);
  assert.equal(/border-(?:sky|emerald|violet|amber|rose|teal|indigo|lime)-\d+/.test(body), false, "no coloured border");
  assert.equal((body.match(/<tbody[^>]*class="border-b border-gray-200 last:border-b-0"/g) ?? []).length, 4, "a thin light-grey line under each group");
});

test("the product name is the only coloured element of a group, in ONE colour for every product", () => {
  const markup = renderToStaticMarkup(createElement(SalesGroupingReport, { data }));
  const names = [...markup.matchAll(/<span data-product-name="[^"]*" class="([^"]*)">([^<]*)<\/span>/g)];
  assert.equal(names.length, 4);
  assert.deepEqual(new Set(names.map((m) => m[1])).size, 1, "the exact same classes for every product");
  assert.equal(names[0][1], "font-semibold text-teal-800");
  assert.deepEqual(names.map((m) => m[2].replace(/&#x27;/g, "'")), ["Aquafina1.5", "Aquafina mini 33", "1/2L هواي", "Sidi Ali"]);
  // outside the margin cells and the name, no other teal in the table
  const table = markup.slice(markup.indexOf("<table"), markup.indexOf("</table>"));
  assert.equal((table.match(/text-teal-\d+/g) ?? []).length, 4);
});

test("margin colours, figures and columns are untouched", () => {
  const markup = renderToStaticMarkup(createElement(SalesGroupingReport, { data }));
  for (const kept of ["text-amber-700", "text-amber-800", "Prix unitaire TTC", "Marge HT", "Taux de marque", "Prix appliqué", "Sous-total", "data-price-row", "data-product-total"]) {
    assert.ok(markup.includes(kept), kept);
  }
});

test("the per-product palette is gone", () => {
  assert.equal(existsSync("lib/daily-sales-colors.ts"), false);
  assert.equal(/daily-sales-colors|PRODUCT_TINTS|tintIndex/.test(read("components/ventes/daily-sales-grouping-view.tsx")), false);
});
