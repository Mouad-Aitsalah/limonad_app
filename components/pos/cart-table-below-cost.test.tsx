import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CartTable } from "@/components/pos/cart-table";
import type { CartLineComputed } from "@/components/pos/pos-layout";
import { PRICE_TONE_CLASS } from "@/lib/pos-price-tone";

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

const RED = PRICE_TONE_CLASS.below;

test("price below the purchase price: the price field is red and flagged below cost on the PC counter POS", () => {
  const markup = render([line({ unitPriceTTC: 100 })]);
  assert.ok(markup.includes(RED));
  assert.ok(markup.includes('data-below-cost="true"'));
  assert.ok(markup.includes('data-price-tone="below"'));
});

test("price equal to the purchase price: red too (0 <= price <= cost), but not 'below cost' (strictly under)", () => {
  const markup = render([line({ unitPriceTTC: 120 })]);
  assert.ok(markup.includes(RED));
  assert.equal(markup.includes("data-below-cost"), false);
});

test("price above the purchase price with no usual price known: neutral", () => {
  const markup = render([line({ unitPriceTTC: 150, priceOverridden: false })]);
  assert.equal(markup.includes(RED), false);
  assert.ok(markup.includes('data-price-tone="neutral"'));
});

test("purchase price unavailable: no red for a positive price (no cost is invented), red for 0", () => {
  for (const purchasePriceTTC of [null, undefined]) {
    const markup = render([line({ unitPriceTTC: 1, purchasePriceTTC })]);
    assert.equal(markup.includes(RED), false);
    assert.ok(markup.includes('data-price-tone="neutral"'));
    // a price of zero needs no cost to be at or under it
    assert.ok(render([line({ unitPriceTTC: 0, purchasePriceTTC })]).includes(RED));
  }
});

test("only the offending line is flagged", () => {
  const markup = render([
    line({ productId: "a", unitPriceTTC: 100 }),
    line({ productId: "b", unitPriceTTC: 200, priceOverridden: false }),
  ]);
  assert.equal(markup.split(RED).length - 1, 1);
});

test("the colour shows on every layout (driver / default table too), the below-cost flag only on the PC counter POS", () => {
  const markup = render([line({ unitPriceTTC: 1 })], { pcLayout: false });
  assert.ok(markup.includes(RED));
  assert.equal(markup.includes("data-below-cost"), false);
});

test("no price input (role that cannot edit): the read-only price carries the colour as text, no input", () => {
  const markup = render([line({ unitPriceTTC: 1 })], { canEditPrice: false });
  assert.equal(/aria-label="Prix TTC de/.test(markup), false);
  assert.ok(markup.includes("font-semibold text-red-700"));
  assert.equal(markup.includes("bg-red-50"), false);
});

test("displayed values are untouched by the colour (below-cost line keeps its amounts)", () => {
  const below = render([line({ unitPriceTTC: 100, totalTTC: 100 })]);
  assert.ok(below.includes('value="100"'));
});
