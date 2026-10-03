import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CartTable } from "@/components/pos/cart-table";
import type { CartLineComputed } from "@/components/pos/pos-layout";

const noop = () => {};

const line = (productId: string, designation: string): CartLineComputed => ({
  productId,
  designation,
  reference: `REF-${productId}`,
  quantity: 2,
  discountUnitAmount: 0,
  unitPriceHT: 52.08,
  unitPriceTTC: 62.5,
  tauxTVA: 20,
  baseHT: 104.16,
  discountAmount: 0,
  netHT: 104.17,
  tvaAmount: 20.83,
  totalTTC: 125,
  transferValue: 0,
});

const lines = [line("1", "1L بومس"), line("2", "1/2L هواي"), line("3", "Coca-Cola 1L pack de 6 bouteilles très long nom")];

function render(extra: { driverMobileStyle?: boolean; pcLayout?: boolean } = {}) {
  return renderToStaticMarkup(
    <CartTable
      lines={lines}
      operationType="sale"
      onIncrement={noop}
      onDecrement={noop}
      onQuantityChange={noop}
      onDiscountChange={noop}
      onRemove={noop}
      {...extra}
    />,
  );
}

const names = (markup: string) => [...markup.matchAll(/<p class="(pr-5 font-medium[^"]*)">/g)].map((m) => m[1]);
const heads = (markup: string) => [...markup.matchAll(/<th [^>]*class="([^"]*)"[^>]*>/g)].map((m) => m[1]);

test("driver POS on phones: product names are x1.15 (15.04px -> 17.296px)", () => {
  assert.ok(Math.abs(15.04 * 1.15 - 17.296) < 1e-9);
  const rendered = names(render({ driverMobileStyle: true }));
  assert.equal(rendered.length, 3);
  for (const cls of rendered) assert.match(cls, /max-lg:text-\[17\.296px\]/);
});

test("the four column titles are bold on phones, same size / colour / alignment", () => {
  const withStyle = heads(render({ driverMobileStyle: true }));
  const without = heads(render());
  assert.equal(withStyle.length, 6, "Produit, Qte, Prix, Rem., Total, (action)");
  const visibleOnPhone = withStyle.filter((cls) => !/max-lg:hidden/.test(cls));
  assert.equal(visibleOnPhone.length, 4, "PRODUIT, QTE, PRIX TTC, REM.");
  for (const cls of visibleOnPhone) {
    assert.match(cls, /max-lg:font-bold/);
    assert.match(cls, /max-lg:text-\[10px\]/, "size unchanged");
  }
  assert.equal(without.some((cls) => /max-lg:font-bold/.test(cls)), false, "opt-in only");
});

test("the reference under the name and the row values keep their classes", () => {
  const on = render({ driverMobileStyle: true });
  const off = render();
  assert.match(on, /<p class="truncate text-xs text-muted-foreground">REF-1<\/p>/);
  // everything except the opt-in classes is identical
  const strip = (markup: string) => markup.replace(/ max-lg:font-bold/g, "").replace(/ max-lg:text-\[17\.296px\]/g, "");
  assert.equal(strip(on), off);
});

test("without the opt-in (counter POS, web) nothing changes", () => {
  const markup = render();
  assert.equal(/17\.296px/.test(markup), false);
  assert.equal(/max-lg:font-bold/.test(markup), false);
  assert.equal(/17\.296px|max-lg:font-bold/.test(render({ pcLayout: true })), false);
});

test("Arabic, French, short and long names are all rendered, wrapping instead of overflowing", () => {
  const markup = render({ driverMobileStyle: true });
  for (const name of ["1L بومس", "1/2L هواي", "Coca-Cola 1L pack de 6 bouteilles très long nom"]) {
    assert.ok(markup.includes(name), name);
  }
  assert.match(markup, /whitespace-normal break-words/);
});

test("quantity and delete controls are still there", () => {
  const markup = render({ driverMobileStyle: true });
  assert.equal((markup.match(/aria-label="Diminuer la quantite"/g) ?? []).length, 3);
  assert.equal((markup.match(/aria-label="Augmenter la quantite"/g) ?? []).length, 3);
  assert.ok((markup.match(/aria-label="Retirer [^"]*? du panier"/g) ?? []).length >= 3);
});

test("only the driver POS turns the option on; the counter POS and the web caisse do not", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../driver-pos/driver-pos-view.tsx"), /onRemove=\{removeProduct\}\s*driverMobileStyle\s*\/>/);
  assert.equal(/driverMobileStyle/.test(read("./pos-layout.tsx")), false);
});
