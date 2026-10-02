import assert from "node:assert/strict";
import { test } from "node:test";

import { isSellingBelowCost, purchasePriceTTC } from "@/lib/pos-margin";

test("purchase price TTC is derived from the HT purchase price and the VAT rate", () => {
  assert.equal(purchasePriceTTC(100, 20), 120);
  assert.equal(purchasePriceTTC(10, 0), 10);
  assert.equal(purchasePriceTTC(33.33, 20), 40);
});

test("unknown purchase price -> null (no alert possible)", () => {
  assert.equal(purchasePriceTTC(undefined, 20), null);
  assert.equal(purchasePriceTTC(null, 20), null);
  assert.equal(purchasePriceTTC(Number.NaN, 20), null);
  assert.equal(purchasePriceTTC(-1, 20), null);
  assert.equal(purchasePriceTTC(10, Number.NaN), null);
});

test("strictly lower than the purchase price TTC -> below cost", () => {
  assert.equal(isSellingBelowCost(119.99, 120), true);
  assert.equal(isSellingBelowCost(0, 120), true);
  assert.equal(isSellingBelowCost(50, 120), true);
});

test("equal to the purchase price TTC -> normal", () => {
  assert.equal(isSellingBelowCost(120, 120), false);
  // float noise below the cent never raises the alert
  assert.equal(isSellingBelowCost(0.1 + 0.2, 0.3), false);
});

test("higher than the purchase price TTC -> normal", () => {
  assert.equal(isSellingBelowCost(120.01, 120), false);
  assert.equal(isSellingBelowCost(500, 120), false);
});

test("no alert without a usable purchase price", () => {
  assert.equal(isSellingBelowCost(1, null), false);
  assert.equal(isSellingBelowCost(1, undefined), false);
  assert.equal(isSellingBelowCost(1, Number.NaN), false);
  assert.equal(isSellingBelowCost(Number.NaN, 120), false);
});

test("a typed price tracks the comparison in real time (price edited step by step)", () => {
  const cost = purchasePriceTTC(100, 20); // 120
  const flags = [100, 119, 119.99, 120, 121, 90].map((price) => isSellingBelowCost(price, cost));
  assert.deepEqual(flags, [true, true, true, false, false, true]);
});
