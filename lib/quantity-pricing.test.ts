import assert from "node:assert/strict";
import { test } from "node:test";

import {
  QUANTITY_PRICE_TIER_LABELS,
  quantityTierValuesFromRow,
  readCompleteQuantityTiers,
  resolveQuantityPrice,
  sumQuantitiesByProduct,
  type QuantityTierValues,
} from "./quantity-pricing";

// The example of the specification: détail 5, semi-gros 4.50, gros 4, Qped 6, Qgros 24.
const tiers: QuantityTierValues = {
  retailPriceHT: 5,
  semiWholesalePriceHT: 4.5,
  semiWholesaleMinQty: 6,
  wholesaleMinQty: 24,
};
const price = (quantity: number, enabled = true, values: Partial<QuantityTierValues> | null = tiers) =>
  resolveQuantityPrice({ enabled, wholesalePriceHT: 4, tiers: values, quantity });

test("the specification table: 1, 5 -> détail; 6, 15, 23 -> semi-gros; 24, 30 -> gros", () => {
  const expected: Array<[number, number, string]> = [
    [1, 5, "RETAIL"],
    [5, 5, "RETAIL"],
    [6, 4.5, "SEMI_WHOLESALE"],
    [15, 4.5, "SEMI_WHOLESALE"],
    [23, 4.5, "SEMI_WHOLESALE"],
    [24, 4, "WHOLESALE"],
    [30, 4, "WHOLESALE"],
  ];
  for (const [quantity, unitPriceHT, tier] of expected) {
    assert.deepEqual(price(quantity), { unitPriceHT, tier }, `Q = ${quantity}`);
  }
});

test("just before, exactly at and just after each threshold", () => {
  assert.equal(price(5).tier, "RETAIL");
  assert.equal(price(6).tier, "SEMI_WHOLESALE");
  assert.equal(price(7).tier, "SEMI_WHOLESALE");
  assert.equal(price(23).tier, "SEMI_WHOLESALE");
  assert.equal(price(24).tier, "WHOLESALE");
  assert.equal(price(25).tier, "WHOLESALE");
});

test("the price follows the quantity up AND down (a quantity going back under a threshold gets its price back)", () => {
  const path = [1, 6, 24, 23, 5, 24, 6, 1].map((quantity) => price(quantity).unitPriceHT);
  assert.deepEqual(path, [5, 4.5, 4, 4.5, 5, 4, 4.5, 5]);
});

test("setting OFF: always the wholesale price, no tier label - the behaviour before this feature", () => {
  for (const quantity of [1, 5, 6, 23, 24, 100]) {
    assert.deepEqual(price(quantity, false), { unitPriceHT: 4, tier: null });
  }
});

test("incomplete or invalid tiers keep the wholesale price: nothing is guessed", () => {
  const incomplete: Array<Partial<QuantityTierValues> | null> = [
    null,
    {},
    { ...tiers, retailPriceHT: null },
    { ...tiers, semiWholesalePriceHT: null },
    { ...tiers, semiWholesaleMinQty: null },
    { ...tiers, wholesaleMinQty: null },
    { ...tiers, semiWholesaleMinQty: 24, wholesaleMinQty: 24 }, // Qped = Qgros: ambiguous
    { ...tiers, semiWholesaleMinQty: 30, wholesaleMinQty: 24 }, // Qped > Qgros
    { ...tiers, semiWholesaleMinQty: 0 }, // a quantity is never 0
    { ...tiers, semiWholesaleMinQty: 2.5 }, // not a whole quantity
    { ...tiers, retailPriceHT: -1 },
    { ...tiers, semiWholesalePriceHT: Number.NaN },
  ];
  for (const values of incomplete) {
    assert.equal(readCompleteQuantityTiers(values), null, JSON.stringify(values));
    for (const quantity of [1, 6, 24]) {
      assert.deepEqual(price(quantity, true, values), { unitPriceHT: 4, tier: null }, JSON.stringify(values));
    }
  }
});

test("Qped = 1 means semi-gros from the first unit (no retail band), and a price of 0 is a valid price", () => {
  const values = { ...tiers, semiWholesaleMinQty: 1, wholesaleMinQty: 2 };
  assert.equal(price(1, true, values).tier, "SEMI_WHOLESALE");
  assert.equal(price(2, true, values).tier, "WHOLESALE");
  assert.deepEqual(price(1, true, { ...tiers, retailPriceHT: 0 }), { unitPriceHT: 0, tier: "RETAIL" });
});

test("Q is the TOTAL per product: 3 then 4 more of the same product are priced on Q = 7", () => {
  const totals = sumQuantitiesByProduct([
    { productId: "a", quantity: 3 },
    { productId: "b", quantity: 1 },
    { productId: "a", quantity: 4 },
  ]);
  assert.equal(totals.get("a"), 7);
  assert.equal(totals.get("b"), 1);
  assert.equal(price(totals.get("a")!).tier, "SEMI_WHOLESALE");
  // priced line by line (3, then 4) both lines would have been at the retail price
  assert.equal(price(3).tier, "RETAIL");
  assert.equal(price(4).tier, "RETAIL");
});

test("tier labels and the Prisma row adapter", () => {
  assert.deepEqual(QUANTITY_PRICE_TIER_LABELS, { RETAIL: "Détail", SEMI_WHOLESALE: "Semi-gros", WHOLESALE: "Gros" });
  const decimal = (value: number) => ({ toNumber: () => value });
  assert.deepEqual(
    quantityTierValuesFromRow({ retailPrice: decimal(5), semiWholesalePrice: decimal(4.5), semiWholesaleMinQty: 6, wholesaleMinQty: 24 }),
    tiers,
  );
  assert.deepEqual(
    quantityTierValuesFromRow({ retailPrice: null, semiWholesalePrice: null, semiWholesaleMinQty: null, wholesaleMinQty: null }),
    { retailPriceHT: null, semiWholesalePriceHT: null, semiWholesaleMinQty: null, wholesaleMinQty: null },
  );
});
