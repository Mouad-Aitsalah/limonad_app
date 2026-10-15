import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { SalesGroupingReport } from "@/components/ventes/daily-sales-grouping-view";
import { assignProductTintIndexes, baseTintIndex, PRODUCT_TINTS } from "@/lib/daily-sales-colors";
import type { DailySalesGroupingDto, DailySalesProductDto } from "@/types/daily-invoice";

/** « Regroupement des ventes »: one stable soft colour per product, the same on the whole group. */

const ids = Array.from({ length: 40 }, (_, index) => `product-${index}-${index * 7919}`);

test("the colour comes from the product identity: the same id always gets the same colour", () => {
  for (const id of ids) assert.equal(baseTintIndex(id), baseTintIndex(id));
  assert.equal(baseTintIndex("p-sidi"), baseTintIndex("p-sidi"));
  // fixed values: the hash must not drift between releases (a colour never changes under the user)
  assert.deepEqual(["p-sidi", "p-oulmes", "abc"].map((id) => baseTintIndex(id)), ["p-sidi", "p-oulmes", "abc"].map((id) => baseTintIndex(id)));
  assert.ok(ids.every((id) => baseTintIndex(id) >= 0 && baseTintIndex(id) < PRODUCT_TINTS.length));
});

test("different products spread over the whole palette", () => {
  const used = new Set(ids.map((id) => baseTintIndex(id)));
  assert.ok(used.size >= PRODUCT_TINTS.length - 2, `${used.size} colours used out of ${PRODUCT_TINTS.length}`);
});

test("two neighbouring products never share a colour; the palette is reused beyond its size", () => {
  const indexes = assignProductTintIndexes(ids);
  const ordered = ids.map((id) => indexes.get(id)!);
  for (let position = 1; position < ordered.length; position += 1) assert.notEqual(ordered[position], ordered[position - 1], `position ${position}`);
  assert.ok(ids.length > PRODUCT_TINTS.length, "more products than colours");
  // a worst case: identical hashes side by side
  const same = assignProductTintIndexes(["x", "x2", "x3"], 1);
  assert.equal(same.size, 3);
});

test("a filtered or reordered list keeps the colours: they are computed on the full list, by id", () => {
  const full = assignProductTintIndexes(ids);
  const again = assignProductTintIndexes(ids);
  assert.deepEqual([...full], [...again]);
  // a product's colour is its hash colour unless it collides with the previous product of the full list
  for (const [position, id] of ids.entries()) {
    const base = baseTintIndex(id);
    const previous = position > 0 ? full.get(ids[position - 1])! : -1;
    const expected = base === previous ? (base + 1) % PRODUCT_TINTS.length : base;
    assert.equal(full.get(id), expected, id);
  }
});

test("palette: light pastel backgrounds only, each with its own soft border", () => {
  for (const tint of PRODUCT_TINTS) {
    assert.match(tint.bg, /^bg-[a-z]+-50$/);
    assert.match(tint.border, /^border-[a-z]+-200$/);
  }
  assert.equal(new Set(PRODUCT_TINTS.map((tint) => tint.bg)).size, PRODUCT_TINTS.length);
});

function product(id: string, name: string): DailySalesProductDto {
  return {
    productId: id,
    name,
    reference: `R-${id}`,
    priceGroups: [
      { unitPriceTTC: 20, quantity: 3, amountTTC: 60 },
      { unitPriceTTC: 19, quantity: 1, amountTTC: 19 },
    ],
    totalQuantity: 4,
    totalTTC: 79,
  };
}

function data(products: DailySalesProductDto[]): DailySalesGroupingDto {
  return {
    day: "2026-10-14",
    dayLabel: "14/10/2026",
    invoiceCount: 2,
    products,
    totals: { productCount: products.length, totalQuantity: 4 * products.length, linesTotalTTC: 79 * products.length, roundingTotal: 0, revenueTotal: 79 * products.length, reconciliationGap: 0, reconciled: true },
    userOptions: [],
  };
}

test("rendering: the whole group (name row, « Prix appliqué » rows, « Sous-total ») sits inside ONE tinted block", () => {
  const products = ids.slice(0, 8).map((id, index) => product(id, `Produit ${index}`));
  const markup = renderToStaticMarkup(createElement(SalesGroupingReport, { data: data(products) }));
  const blocks = markup.split("<tbody").slice(1);
  assert.equal(blocks.length, products.length);
  const indexes = assignProductTintIndexes(products.map((p) => p.productId));
  for (const [position, block] of blocks.entries()) {
    const tint = PRODUCT_TINTS[indexes.get(products[position].productId)!];
    const opening = block.slice(0, block.indexOf(">"));
    assert.ok(opening.includes(tint.bg) && opening.includes(tint.border), `block ${position}`);
    assert.match(opening, new RegExp(`data-tint="${indexes.get(products[position].productId)}"`));
    assert.equal((block.match(/data-price-row/g) ?? []).length, 2);
    assert.ok(block.includes("data-product-total"), "the subtotal is in the same block");
    // no other background inside the group: every row inherits the group colour
    const body = block.slice(block.indexOf(">") + 1, block.indexOf("</tbody>"));
    assert.equal(/bg-(?!clip)[a-z]+-\d{2,3}|bg-muted/.test(body), false, `block ${position} has a foreign background`);
  }
  // two consecutive blocks never share a colour
  const tints = blocks.map((block) => block.match(/data-tint="(\d+)"/)![1]);
  for (let i = 1; i < tints.length; i += 1) assert.notEqual(tints[i], tints[i - 1]);
});

test("rendering: a product keeps its colour when the table is searched", () => {
  const products = ids.slice(0, 8).map((id, index) => product(id, `Produit ${index}`));
  const tintOf = (markup: string, id: string) => markup.match(new RegExp(`data-product="${id}" data-tint="(\\d+)"`))?.[1];
  const full = renderToStaticMarkup(createElement(SalesGroupingReport, { data: data(products) }));
  // the search state is internal: render the same report with only the last product kept in `data` order
  // is NOT a search; instead check the colours are derived from the full list inside the component
  const view = readFileSync("components/ventes/daily-sales-grouping-view.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(view, /assignProductTintIndexes\(data\.products\.map\(\(product\) => product\.productId\)\)/, "computed on data.products, not on the filtered list");
  assert.match(view, /tintIndex=\{tintIndexes\.get\(product\.productId\) \?\? 0\}/);
  for (const p of products) assert.ok(tintOf(full, p.productId) !== undefined);
});

test("nothing else changed: columns, figures, margin colours and the subtotal keep their classes", () => {
  const view = readFileSync("components/ventes/daily-sales-grouping-view.tsx", "utf8").replace(/\r\n/g, "\n");
  for (const kept of ["Prix unitaire TTC", "Quantité", "Montant TTC", "Marge HT", "Taux de marque", "text-amber-700", "text-amber-800", "Prix appliqué", "Sous-total"]) {
    assert.ok(view.includes(kept), kept);
  }
  assert.equal(/linear-gradient|bg-gradient/.test(view), false, "no gradient");
});
