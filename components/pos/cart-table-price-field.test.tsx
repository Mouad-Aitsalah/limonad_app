import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CartTable } from "@/components/pos/cart-table";
import type { CartLineComputed } from "@/components/pos/pos-layout";
import { PRICE_TONE_CLASS, PRICE_TONE_TEXT_CLASS } from "@/lib/pos-price-tone";

const noop = () => {};

/** A cart line of a product that usually sells 20 DH TTC and costs 12 DH TTC. */
function line(unitPriceTTC: number, overrides: Partial<CartLineComputed> = {}): CartLineComputed {
  return {
    productId: "p1",
    designation: "Coca",
    reference: "COC",
    quantity: 1,
    discountUnitAmount: 0,
    unitPriceHT: unitPriceTTC / 1.2,
    unitPriceTTC,
    priceOverridden: unitPriceTTC !== 20,
    tauxTVA: 20,
    baseHT: unitPriceTTC / 1.2,
    discountAmount: 0,
    netHT: unitPriceTTC / 1.2,
    tvaAmount: unitPriceTTC - unitPriceTTC / 1.2,
    totalTTC: unitPriceTTC,
    transferValue: 0,
    originalUnitPriceTTC: 20,
    purchasePriceTTC: 12,
    ...overrides,
  };
}

function render(lines: CartLineComputed[], options: { canEditPrice?: boolean; phoneStyle?: boolean; pcLayout?: boolean } = {}) {
  return renderToStaticMarkup(
    <CartTable
      lines={lines}
      operationType="sale"
      canEditPrice={options.canEditPrice ?? true}
      onPriceChange={noop}
      onIncrement={noop}
      onDecrement={noop}
      onQuantityChange={noop}
      onDiscountChange={noop}
      onRemove={noop}
      phoneStyle={options.phoneStyle}
      pcLayout={options.pcLayout}
    />,
  );
}

const priceInput = (markup: string) => /<input[^>]*aria-label="Prix TTC de[^"]*"[^>]*>/.exec(markup)?.[0] ?? "";
const toneOf = (markup: string) => /data-price-tone="([a-z]+)"/.exec(priceInput(markup))?.[1];

describe("price field", () => {
  it("is a text field with a decimal keyboard (not a number field: it can be empty and takes a comma)", () => {
    const input = priceInput(render([line(20)]));
    assert.match(input, /type="text"/);
    assert.match(input, /inputMode="decimal"/);
    assert.equal(/type="number"/.test(input), false);
    assert.match(input, /value="20"/);
  });

  it("shows the applied price: 15,5 / 0 - and 0 is shown as 0, never as the original price", () => {
    assert.match(priceInput(render([line(15.5)])), /value="15,5"/);
    const zero = priceInput(render([line(0)]));
    assert.match(zero, /value="0"/);
    assert.equal(/value="20"/.test(zero), false);
  });

  it("another line's price does not leak into this one (each field shows its own line)", () => {
    const markup = render([line(15, { productId: "a" }), line(0, { productId: "b" }), line(20, { productId: "c" })]);
    const values = [...markup.matchAll(/<input[^>]*aria-label="Prix TTC de[^"]*"[^>]*value="([^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual(values, ["15", "0", "20"]);
  });
});

describe("price colours in the cart - purchase price 12 DH, usual price 20 DH", () => {
  const cases: Array<[number, "above" | "between" | "below" | "neutral"]> = [
    [25, "above"],
    [15, "between"],
    [12, "below"],
    [5, "below"],
    [0, "below"],
    [20, "neutral"],
  ];
  for (const [price, tone] of cases) {
    it(`${price} DH -> ${tone}`, () => {
      const markup = render([line(price)]);
      assert.equal(toneOf(markup), tone);
      const input = priceInput(markup);
      const classOf = (value: string) => new RegExp(`class="[^"]*${value.split(" ").join("[^\"]*")}[^"]*"`);
      if (tone === "neutral") {
        for (const cls of Object.values(PRICE_TONE_CLASS)) assert.equal(input.includes(cls), false);
        assert.match(input, /border-input/);
        assert.equal(/border-amber-400/.test(input), false, "at the usual price: no override marker either");
      } else {
        assert.ok(input.includes(PRICE_TONE_CLASS[tone]), `${tone} classes`);
        assert.match(input, classOf(PRICE_TONE_CLASS[tone]));
      }
    });
  }

  it("green, orange and red are three different looks", () => {
    const looks = new Set(Object.values(PRICE_TONE_CLASS));
    assert.equal(looks.size, 3);
  });

  it("the colour is on the price only: the quantity, discount and total cells are not recoloured", () => {
    const markup = render([line(5)]);
    const outside = markup.replace(priceInput(markup), "");
    for (const cls of ["text-red-700", "text-orange-600", "text-emerald-700"]) assert.equal(outside.includes(cls), false, cls);
  });

  it("works on the phone layout and the PC layout too", () => {
    for (const options of [{ phoneStyle: true }, { pcLayout: true }, { phoneStyle: true, pcLayout: true }]) {
      assert.equal(toneOf(render([line(25)], options)), "above");
      assert.equal(toneOf(render([line(0)], options)), "below");
    }
  });
});

describe("price colours - missing references", () => {
  it("purchase price = usual price: red below, neutral at it, green above", () => {
    assert.equal(toneOf(render([line(19, { purchasePriceTTC: 20 })])), "below");
    assert.equal(toneOf(render([line(20, { purchasePriceTTC: 20 })])), "neutral");
    assert.equal(toneOf(render([line(21, { purchasePriceTTC: 20 })])), "above");
  });

  it("purchase price unavailable: neutral (a manual price keeps its amber marker), but 0 DH is red", () => {
    for (const purchasePriceTTC of [null, undefined]) {
      const markup = render([line(15, { purchasePriceTTC })]);
      assert.equal(toneOf(markup), "neutral");
      assert.match(priceInput(markup), /border-amber-400/);
      assert.equal(toneOf(render([line(0, { purchasePriceTTC })])), "below");
    }
  });

  it("usual price unavailable: no error, only the cost can speak", () => {
    for (const originalUnitPriceTTC of [null, undefined]) {
      assert.equal(toneOf(render([line(12, { originalUnitPriceTTC })])), "below");
      assert.equal(toneOf(render([line(15, { originalUnitPriceTTC })])), "neutral");
      assert.equal(toneOf(render([line(25, { originalUnitPriceTTC })])), "neutral");
    }
  });
});

describe("read-only price (a role without the field)", () => {
  it("is coloured as text only - no input, no border or background", () => {
    const red = render([line(5)], { canEditPrice: false });
    assert.equal(/aria-label="Prix TTC de/.test(red), false);
    assert.ok(red.includes(PRICE_TONE_TEXT_CLASS.below));
    assert.equal(red.includes("bg-red-50"), false);
    assert.ok(render([line(25)], { canEditPrice: false }).includes(PRICE_TONE_TEXT_CLASS.above));
    assert.ok(render([line(15)], { canEditPrice: false }).includes(PRICE_TONE_TEXT_CLASS.between));
    for (const cls of Object.values(PRICE_TONE_TEXT_CLASS)) assert.equal(render([line(20)], { canEditPrice: false }).includes(cls), false);
  });
});
