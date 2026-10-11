import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CartTable } from "@/components/pos/cart-table";
import type { CartLineComputed } from "@/components/pos/pos-layout";
import { PricingSettingsView } from "@/components/parametres/pricing-settings-view";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import { resolveQuantityPrice, sumQuantitiesByProduct, type QuantityTiers } from "@/lib/quantity-pricing";

const noop = () => {};
// Specification example, HT at 20 % VAT: détail 5.00 TTC, semi-gros 4.50 TTC, gros 4.00 TTC, Qped 6, Qgros 24.
const tiers: QuantityTiers = { retailPriceHT: 4.17, semiWholesalePriceHT: 3.75, semiWholesaleMinQty: 6, wholesaleMinQty: 24 };
const WHOLESALE_HT = 3.33;

/** What pos-layout computes for one cart line (same functions, same order). */
function cartLine(quantity: number, options: { enabled?: boolean; overrideHT?: number; discount?: number } = {}): CartLineComputed {
  const price = resolveQuantityPrice({ enabled: options.enabled ?? true, wholesalePriceHT: WHOLESALE_HT, tiers, quantity });
  const unitPriceHT = options.overrideHT ?? price.unitPriceHT;
  const totals = computeDiscountedLineTotals({ unitPriceHT, taxRate: 20, quantity, discountUnitAmount: options.discount ?? 0 });
  return {
    productId: "p1",
    designation: "Eau 5L",
    reference: "EAU-5L",
    quantity,
    discountUnitAmount: totals.discountUnitAmount,
    unitPriceHT,
    unitPriceTTC: Math.round(unitPriceHT * 1.2 * 100) / 100,
    priceOverridden: options.overrideHT != null,
    quantityPriceTier: options.overrideHT != null ? null : price.tier,
    tauxTVA: 20,
    baseHT: unitPriceHT * quantity,
    discountAmount: totals.discountAmount,
    netHT: totals.totalHT,
    tvaAmount: totals.taxAmount,
    totalTTC: totals.totalTTC,
    transferValue: 0,
  };
}
const renderCart = (line: CartLineComputed) =>
  renderToStaticMarkup(
    <CartTable
      lines={[line]}
      operationType="sale"
      onIncrement={noop}
      onDecrement={noop}
      onQuantityChange={noop}
      onDiscountChange={noop}
      onRemove={noop}
      pcLayout
      phoneStyle
    />,
  );
const tierLabel = (markup: string) => markup.match(/data-quantity-tier="([A-Z_]+)"[^>]*>([^<]+)</)?.slice(1) ?? null;

test("the cart line shows the price really applied and a discreet tier label, following the quantity", () => {
  const cases: Array<[number, string, string, number]> = [
    [1, "RETAIL", "Détail", 5],
    [5, "RETAIL", "Détail", 25],
    [6, "SEMI_WHOLESALE", "Semi-gros", 27],
    [23, "SEMI_WHOLESALE", "Semi-gros", 103.5],
    [24, "WHOLESALE", "Gros", 96],
    [30, "WHOLESALE", "Gros", 120],
  ];
  for (const [quantity, tier, label, totalTTC] of cases) {
    const line = cartLine(quantity);
    assert.equal(line.totalTTC, totalTTC, `Q=${quantity}`);
    assert.deepEqual(tierLabel(renderCart(line)), [tier, label], `Q=${quantity}`);
  }
});

test("up then down: crossing a threshold back re-applies the lower-quantity price", () => {
  const unitTTC = [5, 6, 24, 23, 5].map((quantity) => cartLine(quantity).unitPriceTTC);
  assert.deepEqual(unitTTC, [5, 4.5, 4, 4.5, 5]);
});

test("3 units then 4 more of the same product = ONE line priced on Q = 7", () => {
  const cart = [{ productId: "p1", quantity: 3 }];
  // addToCart merges the same product into its line (+1 per tap): 3 + 4
  for (let tap = 0; tap < 4; tap += 1) cart[0] = { ...cart[0], quantity: cart[0].quantity + 1 };
  const q = sumQuantitiesByProduct(cart).get("p1")!;
  assert.equal(q, 7);
  assert.equal(cartLine(q).quantityPriceTier, "SEMI_WHOLESALE");
});

test("setting OFF: no label at all and the wholesale price - the cart looks exactly as before", () => {
  const markup = renderCart(cartLine(1, { enabled: false }));
  assert.equal(markup.includes("data-quantity-tier"), false);
  assert.equal(cartLine(1, { enabled: false }).unitPriceHT, WHOLESALE_HT);
});

test("an admin manual price wins over the tier (no tier label); the discount still applies after the tier price", () => {
  assert.equal(tierLabel(renderCart(cartLine(1, { overrideHT: 2.5 }))), null);
  assert.equal(cartLine(1, { overrideHT: 2.5 }).unitPriceHT, 2.5);
  // 6 units at semi-gros 4.50 TTC with 0.50 DH off each -> 4.00 x 6
  assert.equal(cartLine(6, { discount: 0.5 }).totalTTC, 24);
});

test("Paramètres -> Tarification: the switch, its label, OFF by default", () => {
  const off = renderToStaticMarkup(<PricingSettingsView initialSettings={{ quantityPricingEnabled: false }} />);
  assert.ok(off.includes("Activer la tarification automatique selon la quantité"));
  assert.match(off, /role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/);
  assert.ok(off.includes("Désactivée : le POS vend au prix gros, comme avant."));
  const on = renderToStaticMarkup(<PricingSettingsView initialSettings={{ quantityPricingEnabled: true }} />);
  assert.match(on, /aria-checked="true"/);
});
