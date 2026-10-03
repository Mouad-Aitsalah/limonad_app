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

test("the column titles are bold on phones, same size / colour; Total TTC joins them", () => {
  const withStyle = heads(render({ driverMobileStyle: true }));
  const without = heads(render());
  assert.equal(withStyle.length, 6, "Produit, Qte, Prix, Rem., Total, (action)");
  const visibleOnPhone = withStyle.filter((cls) => !/max-lg:hidden/.test(cls));
  assert.equal(visibleOnPhone.length, 5, "PRODUIT, QTE, PRIX TTC, REM., TOTAL TTC");
  for (const cls of visibleOnPhone) {
    assert.match(cls, /max-lg:font-bold/);
    assert.match(cls, /max-lg:text-\[10px\]/, "size unchanged");
  }
  assert.equal(without.some((cls) => /max-lg:font-bold/.test(cls)), false, "opt-in only");
  assert.equal(without.filter((cls) => !/max-lg:hidden/.test(cls)).length, 4, "no Total column on phones without the opt-in");
});

test("the reference under the name stays; apart from classes, the markup only differs by the Total TTC title and the unit's space", () => {
  const on = render({ driverMobileStyle: true });
  const off = render();
  assert.match(on, /<p class="truncate text-xs text-muted-foreground">REF-1<\/p>/);
  const content = (markup: string) =>
    markup
      .replace(/ class="[^"]*"/g, "")
      .replace(/<span><\/span>/g, "")
      .replace(/<span>Total TTC<\/span><span>Total<\/span>/g, "Total")
      .replace(/ /g, " ");
  assert.equal(content(on), content(off));
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

test("driver POS on phones: unit price TTC and quantity share the same 17.6px", () => {
  assert.ok(Math.abs(16 * 1.1 - 17.6) < 1e-9);
  const markup = render({ driverMobileStyle: true });
  const quantityInputs = [...markup.matchAll(/<input[^>]*aria-label="Quantite"[^>]*>/g)].map((m) => m[0]);
  assert.equal(quantityInputs.length, 3);
  for (const input of quantityInputs) {
    assert.match(input, /max-lg:text-\[17\.6px\]!/, "important: the global phone rule forces 1rem on every input");
    assert.match(input, /max-lg:w-8/, "box 4px wider for 3-digit quantities");
  }
  const prices = [...markup.matchAll(/<span class="([^"]*)">62,50/g)].map((m) => m[1]);
  assert.equal(prices.length, 3);
  for (const cls of prices) {
    assert.match(cls, /max-lg:text-\[17\.6px\]/, "same size as the quantity");
    assert.equal(/max-lg:text-xs|13\.2px/.test(cls), false, "the 12px class is replaced, not stacked");
    // a 4-digit amount may drop its unit under it (centred) instead of overflowing
    assert.match(cls, /max-lg:block/);
    assert.match(cls, /max-lg:whitespace-normal/);
  }
  // value and format untouched: "62,50 DH" (regular space only so the unit can wrap)
  assert.equal((markup.match(/62,50[  ]DH/g) ?? []).length, 3);
});

test("driver POS on phones: Qte / Prix / Rem. / Total cells are centred on the row; fixed narrow columns, Produit takes the rest", () => {
  const markup = render({ driverMobileStyle: true });
  const cells = [...markup.matchAll(/<td[^>]*class="([^"]*)"/g)].map((m) => m[1]);
  const middle = cells.filter((cls) => /max-lg:align-middle!/.test(cls));
  assert.equal(middle.length, 12, "3 rows x (Qte, Prix, Rem., Total)");
  // titles and cells of a column share one phone width
  const widths = (markup: string, tag: "th" | "td") =>
    [...markup.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, "g"))].map((m) => m[1]);
  for (const tag of ["th", "td"] as const) {
    const all = widths(markup, tag);
    for (const cls of all.filter((c) => /w-\[40%\]/.test(c))) assert.match(cls, /max-lg:w-auto/);
    for (const cls of all.filter((c) => /w-\[26%\]/.test(c))) assert.match(cls, /max-lg:w-20 max-lg:px-0/);
    for (const cls of all.filter((c) => /w-\[19%\]/.test(c))) assert.match(cls, /max-lg:w-\[66px\]/);
    for (const cls of all.filter((c) => /w-\[15%\]/.test(c))) assert.match(cls, /max-lg:w-8/);
    for (const cls of all.filter((c) => /lg:w-\[6\.25rem\]/.test(c))) assert.match(cls, /max-lg:w-\[58px\]/);
  }
  const off = render();
  assert.equal(/align-middle!/.test(off), false);
  assert.equal(/max-lg:w-(?:auto|20|\[66px\]|\[58px\])/.test(off), false);
});

test("driver POS on phones: Total TTC is visible, centred, wraps its unit instead of overflowing; desktop keeps its Total", () => {
  const on = render({ driverMobileStyle: true });
  const off = render();
  const totalCells = (markup: string) =>
    [...markup.matchAll(/<td[^>]*class="([^"]*lg:w-\[6\.25rem\][^"]*)"/g)].map((m) => m[1]);
  assert.equal(totalCells(on).length, 3);
  for (const cls of totalCells(on)) {
    assert.match(cls, /max-lg:table-cell/);
    assert.equal(/max-lg:hidden/.test(cls), false, "no longer hidden on phones");
    assert.match(cls, /max-lg:text-center/);
    assert.match(cls, /max-lg:whitespace-normal/);
    assert.match(cls, /max-lg:\[overflow-wrap:anywhere\]/);
    assert.match(cls, /text-right/, "desktop alignment kept");
    assert.match(cls, /lg:px-2 lg:pr-3/, "desktop padding kept");
  }
  for (const cls of totalCells(off)) assert.match(cls, /max-lg:hidden/);
  // same amount, same format (regular space so the unit can drop below the amount)
  assert.equal((on.match(/125,00[  ]DH/g) ?? []).length, 3, "line total 62,50 x 2");
  // title: "Total TTC" on phones, "Total" from lg
  assert.match(on, /<span class="lg:hidden">Total TTC<\/span><span class="hidden lg:inline">Total<\/span>/);
  assert.equal(/Total TTC/.test(off), false);
});

test("previous improvements are kept together with the new ones", () => {
  const markup = render({ driverMobileStyle: true });
  assert.match(markup, /max-lg:text-\[17\.296px\]/, "names x1.15");
  assert.match(markup, /max-lg:font-bold/, "bold titles");
  assert.match(markup, /<p class="truncate text-xs text-muted-foreground">REF-1<\/p>/, "reference unchanged");
});

test("the +/- buttons keep their size; nothing changes without the opt-in", () => {
  const on = render({ driverMobileStyle: true });
  const off = render();
  const buttonClasses = (markup: string) => [...markup.matchAll(/<button[^>]*aria-label="(?:Diminuer|Augmenter) la quantite"[^>]*class="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(buttonClasses(on), buttonClasses(off));
  assert.equal(/17\.6px|13\.2px|max-lg:w-8|align-middle!/.test(off), false);
  assert.equal(/17\.6px|13\.2px|max-lg:w-8|align-middle!/.test(render({ pcLayout: true })), false, "counter POS unchanged");
});

test("driver POS: the cart table reclaims the card padding on phones only (no horizontal scroll)", () => {
  const view = readFileSync(new URL("../driver-pos/driver-pos-view.tsx", import.meta.url), "utf8");
  assert.match(view, /className="rounded-2xl border border-border max-lg:-mx-3">\s*<CartTable/);
  assert.equal(/max-lg:-mx-3/.test(readFileSync(new URL("./pos-layout.tsx", import.meta.url), "utf8")), false);
});
