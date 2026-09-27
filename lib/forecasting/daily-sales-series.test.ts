import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, densifyProductDailySales, enumerateDays, type ProductDailySalesRow } from "./daily-sales-series";

const row = (date: string, productId: string, productName: string, quantitySold: number): ProductDailySalesRow => ({
  date,
  productId,
  productName,
  quantitySold,
});

test("day helpers: enumerate is inclusive and crosses month / year / leap boundaries", () => {
  assert.deepEqual(enumerateDays("2024-12-30", "2025-01-02"), ["2024-12-30", "2024-12-31", "2025-01-01", "2025-01-02"]);
  assert.deepEqual(enumerateDays("2024-02-28", "2024-03-01"), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  assert.equal(addDays("2025-03-01", -1), "2025-02-28");
  assert.deepEqual(enumerateDays("2025-01-05", "2025-01-04"), []);
});

test("complete series: days without sale are 0, days with sale keep their quantity", () => {
  const out = densifyProductDailySales({
    rows: [row("2025-01-01", "p1", "Hawaï 1L", 5), row("2025-01-03", "p1", "Hawaï 1L", 8), row("2025-01-05", "p1", "Hawaï 1L", 12)],
    products: [{ productId: "p1", productName: "Hawaï 1L", createdDay: "2024-06-01" }],
    to: "2025-01-05",
  });
  assert.deepEqual(
    out.filter((r) => r.date >= "2025-01-01").map((r) => [r.date, r.quantitySold]),
    [["2025-01-01", 5], ["2025-01-02", 0], ["2025-01-03", 8], ["2025-01-04", 0], ["2025-01-05", 12]],
  );
});

test("no zero is invented before the product existed", () => {
  const out = densifyProductDailySales({
    rows: [row("2025-01-04", "p2", "Fanta", 1)],
    products: [{ productId: "p2", productName: "Fanta", createdDay: "2025-01-03" }],
    to: "2025-01-05",
  });
  assert.deepEqual(out.map((r) => [r.date, r.quantitySold]), [["2025-01-03", 0], ["2025-01-04", 1], ["2025-01-05", 0]]);
});

test("a product created AFTER its first sale (imported catalogue) keeps its history from that sale", () => {
  const out = densifyProductDailySales({
    rows: [row("2025-01-02", "p3", "Sprite", 4)],
    products: [{ productId: "p3", productName: "Sprite", createdDay: "2025-06-01" }],
    to: "2025-01-03",
  });
  assert.deepEqual(out.map((r) => [r.date, r.quantitySold]), [["2025-01-02", 4], ["2025-01-03", 0]]);
});

test("a product without any sale gets an all-zero series from its creation day; one created after `to` is skipped", () => {
  const out = densifyProductDailySales({
    rows: [],
    products: [
      { productId: "p4", productName: "Jamais vendu", createdDay: "2025-01-02" },
      { productId: "p5", productName: "Trop récent", createdDay: "2025-02-01" },
    ],
    to: "2025-01-03",
  });
  assert.deepEqual(out.map((r) => [r.productId, r.date, r.quantitySold]), [["p4", "2025-01-02", 0], ["p4", "2025-01-03", 0]]);
});

test("no Produit x Jour duplicate, even when the input rows repeat a pair; products stay separated", () => {
  const out = densifyProductDailySales({
    rows: [row("2025-01-01", "p1", "A", 2), row("2025-01-01", "p1", "A", 3), row("2025-01-01", "p2", "B", 7)],
    products: [
      { productId: "p1", productName: "A", createdDay: "2025-01-01" },
      { productId: "p2", productName: "B", createdDay: "2025-01-01" },
    ],
    to: "2025-01-02",
  });
  const keys = out.map((r) => `${r.productId}|${r.date}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(out.find((r) => r.productId === "p1" && r.date === "2025-01-01")?.quantitySold, 5);
  assert.equal(out.find((r) => r.productId === "p2" && r.date === "2025-01-01")?.quantitySold, 7);
  assert.equal(out.length, 4);
});
