import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { MobileSelectedProduct } from "@/components/pos/mobile-selected-product";

const product = (quantity: number) => ({
  designation: "Coca-Cola 1L",
  quantity,
  priceTTC: 12.5,
  imageUrl: null,
});

test("driver POS (inline variant): the quantity is 1.3 x the former 12px = 15.6px", () => {
  const markup = renderToStaticMarkup(<MobileSelectedProduct product={product(3)} variant="inline" />);
  assert.match(markup, /class="shrink-0 text-\[15\.6px\][^"]*font-bold[^"]*"/);
  assert.equal(/text-xs/.test(markup.match(/<span class="shrink-0[^>]*>/)![0]), false, "old 12px class is gone");
  assert.ok(markup.includes("×3"));
  assert.ok(Math.abs(12 * 1.3 - 15.6) < 1e-9);
});

test("one or several digits stay on one line (shrink-0 + tabular numbers) and keep their aria label", () => {
  for (const quantity of [1, 7, 12, 150, 1250]) {
    const markup = renderToStaticMarkup(<MobileSelectedProduct product={product(quantity)} variant="inline" />);
    assert.ok(markup.includes(`×${quantity}`), `×${quantity}`);
    assert.ok(markup.includes(`aria-label="Quantité : ${quantity}"`));
    assert.match(markup, /shrink-0 text-\[15\.6px\] leading-none font-bold tabular-nums/);
  }
});

test("colour, name and price are untouched in the inline variant", () => {
  const markup = renderToStaticMarkup(<MobileSelectedProduct product={product(2)} variant="inline" />);
  assert.match(markup, /text-emerald-700/);
  assert.match(markup, /text-\[11px\]/); // designation/price line keeps its size
  assert.ok(markup.includes("Coca-Cola 1L"));
});

test("the overlay variant (counter POS) is not resized", () => {
  const markup = renderToStaticMarkup(<MobileSelectedProduct product={product(3)} />);
  assert.match(markup, /text-xl font-bold tabular-nums text-emerald-700/);
  assert.equal(/15\.6px/.test(markup), false);
});

test("nothing is rendered without a product", () => {
  assert.equal(renderToStaticMarkup(<MobileSelectedProduct product={null} variant="inline" />), "");
});
