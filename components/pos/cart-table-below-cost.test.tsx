import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CartTable } from "@/components/pos/cart-table";
import type { CartLineComputed } from "@/components/pos/pos-layout";

const noop = () => {};

function line(overrides: Partial<CartLineComputed>): CartLineComputed {
  return {
    productId: "p1",
    designation: "Coca",
    reference: "COC",
    quantity: 1,
    discountUnitAmount: 0,
    unitPriceHT: 100,
    unitPriceTTC: 120,
    priceOverridden: true,
    tauxTVA: 20,
    baseHT: 100,
    discountAmount: 0,
    netHT: 100,
    tvaAmount: 20,
    totalTTC: 120,
    transferValue: 0,
    purchasePriceTTC: 120,
    ...overrides,
  };
}

function render(lines: CartLineComputed[], extra: { pcLayout?: boolean; canEditPrice?: boolean } = {}) {
  return renderToStaticMarkup(
    <CartTable
      lines={lines}
      operationType="sale"
      canEditPrice={extra.canEditPrice ?? true}
      onPriceChange={noop}
      onIncrement={noop}
      onDecrement={noop}
      onQuantityChange={noop}
      onDiscountChange={noop}
      onRemove={noop}
      pcLayout={extra.pcLayout ?? true}
    />,
  );
}

const RED = "lg:border-red-400 lg:bg-red-50";

test("price below the purchase price: the PC price field is flagged red", () => {
  const markup = render([line({ unitPriceTTC: 100 })]);
  assert.ok(markup.includes(RED));
  assert.ok(markup.includes('data-below-cost="true"'));
});

test("price equal to the purchase price: normal style", () => {
  const markup = render([line({ unitPriceTTC: 120 })]);
  assert.equal(markup.includes(RED), false);
  assert.equal(markup.includes("data-below-cost"), false);
});

test("price above the purchase price: normal style", () => {
  const markup = render([line({ unitPriceTTC: 150 })]);
  assert.equal(markup.includes(RED), false);
});

test("purchase price unavailable: no alert", () => {
  for (const purchasePriceTTC of [null, undefined]) {
    const markup = render([line({ unitPriceTTC: 1, purchasePriceTTC })]);
    assert.equal(markup.includes(RED), false);
  }
});

test("only the offending line is flagged", () => {
  const markup = render([
    line({ productId: "a", unitPriceTTC: 100 }),
    line({ productId: "b", unitPriceTTC: 200 }),
  ]);
  assert.equal(markup.split(RED).length - 1, 1);
});

test("never on the driver POS / default table (pcLayout off), even below cost", () => {
  const markup = render([line({ unitPriceTTC: 1 })], { pcLayout: false });
  assert.equal(markup.includes("lg:bg-red-50"), false);
  assert.equal(markup.includes("data-below-cost"), false);
});

test("no price input (non-admin) -> nothing to flag", () => {
  const markup = render([line({ unitPriceTTC: 1 })], { canEditPrice: false });
  assert.equal(markup.includes("lg:bg-red-50"), false);
});

test("displayed values are untouched by the alert (below-cost line keeps its amounts)", () => {
  const below = render([line({ unitPriceTTC: 100, totalTTC: 100 })]);
  assert.ok(below.includes('value="100"'));
});
