import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CartTable } from "@/components/pos/cart-table";
import type { CartLineComputed } from "@/components/pos/pos-layout";
import { PHONE_PRODUCT_TILE_NAME_CLASS } from "@/components/pos/phone-pos-style";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const noop = () => {};

const line = (productId: string, designation: string, unitPriceTTC: number): CartLineComputed => ({
  productId,
  designation,
  reference: `REF-${productId}`,
  quantity: 120,
  discountUnitAmount: 4,
  unitPriceHT: unitPriceTTC / 1.2,
  unitPriceTTC,
  tauxTVA: 20,
  baseHT: 0,
  discountAmount: 0,
  netHT: 0,
  tvaAmount: 0,
  totalTTC: (unitPriceTTC - 4) * 120,
  transferValue: 0,
});

const lines = [line("1", "1L بومس", 12), line("2", "Coca-Cola 1L pack de 6 bouteilles", 1250.5)];

function render(extra: { canEditPrice?: boolean; phoneStyle?: boolean }) {
  return renderToStaticMarkup(
    <CartTable
      lines={lines}
      operationType="sale"
      onIncrement={noop}
      onDecrement={noop}
      onQuantityChange={noop}
      onDiscountChange={noop}
      onPriceChange={noop}
      onRemove={noop}
      pcLayout
      {...extra}
    />,
  );
}

// ---- admin / cashier cart table -------------------------------------------------------------

test("counter POS cart on phones: same phone look as the driver, desktop classes kept", () => {
  const markup = render({ phoneStyle: true });
  assert.match(markup, /max-lg:text-\[17\.296px\]/, "names x1.15");
  assert.match(markup, /lg:text-\[20\.304px\]/, "desktop name size kept");
  assert.match(markup, /max-lg:table-cell/, "Total TTC shown on phones");
  assert.match(markup, /<span class="lg:hidden">Total TTC<\/span><span class="hidden lg:inline">Total<\/span>/);
  assert.match(markup, /lg:h-\[2\.625rem\] lg:w-\[4\.125rem\] lg:text-\[21px\]/, "desktop quantity field kept");
  // every phone-only class is `max-lg:` - nothing leaks to >= lg
  const phoneOnly = ["max-lg:w-auto", "max-lg:w-20", "max-lg:w-[66px]", "max-lg:w-[58px]", "max-lg:align-middle!"];
  for (const cls of phoneOnly) assert.ok(markup.includes(cls), cls);
});

test("without the option the counter POS cart is exactly what it was", () => {
  const off = render({});
  assert.equal(/17\.296px|17\.6px|align-middle!|max-lg:table-cell|Total TTC/.test(off), false);
  assert.match(off, /max-lg:hidden lg:w-\[6\.25rem\]/, "Total still hidden on phones");
});

test("admin phone: the price stays an editable field sized for the Prix column; cashier has none", () => {
  const admin = render({ canEditPrice: true, phoneStyle: true });
  const inputs = [...admin.matchAll(/<input[^>]*aria-label="Prix TTC de[^"]*"[^>]*class="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(inputs.length, 2);
  for (const cls of inputs) {
    assert.match(cls, /max-lg:w-\[62px\] max-lg:text-\[17\.6px\]!/);
    assert.match(cls, /lg:w-\[6\.5rem\]/, "desktop price field kept");
  }
  // cashier: canEditPrice is false -> a plain price, no input to change it
  const cashier = render({ canEditPrice: false, phoneStyle: true });
  assert.equal(/aria-label="Prix TTC de/.test(cashier), false);
  assert.match(cashier, /<span class="max-lg:block max-lg:text-\[17\.6px\]/);
});

test("amounts keep their value and format (discounted total of a 120-unit line)", () => {
  const markup = render({ phoneStyle: true });
  assert.ok(/1\.250,50\sDH/.test(markup));
  assert.ok(/12,00\sDH/.test(markup));
  assert.ok(/149\.580,00\sDH/.test(markup), "(1250.50 - 4) x 120");
  assert.ok(/960,00\sDH/.test(markup), "(12 - 4) x 120");
});

// ---- POS layout (admin + cashier) ------------------------------------------------------------

test("the permissions of the counter POS are untouched", () => {
  const layout = read("./pos-layout.tsx");
  assert.match(layout, /const canEditLinePrice = currentUser\?\.role === "admin";/);
  assert.match(layout, /canEditPrice=\{canEditLinePrice\}/);
});

test("phone layout: sticky tabs, sticky search block with supplier + last product, tile names, card, no overlay", () => {
  const layout = read("./pos-layout.tsx");
  assert.match(layout, /className="sticky top-16 z-20 bg-background lg:hidden"/);
  assert.match(layout, /max-lg:sticky max-lg:top-28 max-lg:z-20 max-lg:space-y-3 max-lg:bg-background/);
  assert.match(layout, /variant="inline"/);
  assert.equal(/<MobileSelectedProduct[^>]*className="lg:hidden"/.test(layout), false, "no more floating overlay");
  assert.match(layout, /\$\{PHONE_PRODUCT_TILE_NAME_CLASS\}/);
  assert.match(layout, /max-lg:rounded-\[24px\] max-lg:border-0 max-lg:p-4/);
  assert.match(layout, /pcLayout\s*phoneStyle/);
  // the invoice navigation (Nouvelle facture, tabs) and the status bar remain
  for (const text of ["Nouvelle facture", "Facture précédente", "Facture suivante", "OfflineStatusBar", "InvoiceActions"]) {
    assert.ok(layout.includes(text), text);
  }
});

test("every product tile rule is phone-only", () => {
  for (const token of PHONE_PRODUCT_TILE_NAME_CLASS.split(" ")) {
    assert.ok(token.startsWith("max-lg:"), token);
  }
  assert.match(PHONE_PRODUCT_TILE_NAME_CLASS, /text-\[19\.5px\]/);
});

test("the driver POS does not use the new shared style module (its own markup is unchanged)", () => {
  const driver = read("../driver-pos/driver-pos-view.tsx");
  assert.equal(/phone-pos-style|PHONE_PRODUCT_TILE_NAME_CLASS/.test(driver), false);
  assert.match(driver, /lg:\[&_button_p\.line-clamp-2\]:text-\[31\.5px\]/, "driver tile rule intact");
});

test("desktop only: the cart card extends 20px to the right; phones and tablets get no margin change", () => {
  const layout = read("./pos-layout.tsx");
  const cartClass = layout.match(/id="mobile-pos-cart"[\s\S]*?className=\{`([^`]*)`\}/)?.[1] ?? "";
  assert.ok(cartClass.length > 0, "cart section class found");
  const marginTokens = cartClass.split(/\s+/).filter((token) => /(^|:)-?m[rxlt]?-/.test(token));
  assert.deepEqual(marginTokens, ["lg:-mr-5"], "the only margin utility is the desktop one");
  // the rest of the card (colours, borders, radius, shadow, padding) is unchanged
  for (const kept of ["rounded-3xl", "border-border", "bg-card", "shadow-[0_10px_30px_rgba(15,23,42,0.06)]", "lg:p-4", "lg:order-2", "lg:overflow-y-auto"]) {
    assert.ok(cartClass.includes(kept), kept);
  }
  // the three fields keep their own grid and classes
  assert.match(layout, /sm:grid-cols-\[4fr_3fr_3fr\] lg:grid-cols-3/);
  assert.ok(layout.includes("lg:h-11 lg:text-[19.6px] lg:font-bold"));
  // the driver POS is not touched
  assert.equal(/lg:-mr-5/.test(read("../driver-pos/driver-pos-view.tsx")), false);
});
