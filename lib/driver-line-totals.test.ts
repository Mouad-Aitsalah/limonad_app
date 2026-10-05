import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { computeDriverLineTotals } from "@/lib/driver-line-totals";
import { roundMoney } from "@/lib/money";
import { computePriceTTC } from "@/lib/product-pricing";

/** The catalogue stores HT with 2 decimals; the driver sees TTC = roundMoney(HT x (1 + VAT)). */
function catalogue(ttcTarget: number, taxRate: number) {
  const unitPriceHT = roundMoney(ttcTarget / (1 + taxRate / 100));
  const unitPriceTTC = computePriceTTC(unitPriceHT, taxRate);
  return { unitPriceHT, unitPriceTTC };
}

/** The formula the driver POS used before this fix (HT x quantity first). */
function legacyTotalTTC(unitPriceHT: number, taxRate: number, quantity: number, discountRate: number) {
  const grossHT = unitPriceHT * quantity;
  const discountAmount = roundMoney(grossHT * (discountRate / 100));
  const totalHT = roundMoney(grossHT - discountAmount);
  const taxAmount = roundMoney(totalHT * (taxRate / 100));
  return roundMoney(totalHT + taxAmount);
}

const line = (ttc: number, taxRate: number, quantity: number, discountRate = 0) => {
  const price = catalogue(ttc, taxRate);
  return { ...price, totals: computeDriverLineTotals({ ...price, taxRate, quantity, discountRate }), taxRate, quantity };
};

test("the reported bug: 62.50 x 2 used to give 124.99, now 125.00", () => {
  const { unitPriceHT, taxRate } = { ...catalogue(62.5, 20), taxRate: 20 };
  assert.equal(legacyTotalTTC(unitPriceHT, taxRate, 2, 0), 124.99, "old formula reproduces the bug");
  assert.equal(line(62.5, 20, 2).totals.totalTTC, 125);
});

test("required cases: 62.50x2, 62.50x3, 17.50x2, 72.00x2 (VAT 20%)", () => {
  assert.equal(line(62.5, 20, 2).totals.totalTTC, 125);
  assert.equal(line(62.5, 20, 3).totals.totalTTC, 187.5);
  assert.equal(line(17.5, 20, 2).totals.totalTTC, 35);
  assert.equal(line(72, 20, 2).totals.totalTTC, 144);
});

test("the unit TTC the driver sees is preserved: total = unit TTC x quantity for every quantity", () => {
  for (const ttc of [62.5, 17.5, 72, 12.99, 0.5, 199.9, 3.33]) {
    for (let quantity = 1; quantity <= 24; quantity += 1) {
      const row = line(ttc, 20, quantity);
      assert.equal(row.totals.totalTTC, roundMoney(row.unitPriceTTC * quantity), `${ttc} x ${quantity}`);
    }
  }
});

test("HT + VAT always add up exactly to TTC, and no line shows a negative or phantom discount", () => {
  for (const vat of [0, 7, 10, 14, 20]) {
    for (let cents = 50; cents <= 20000; cents += 37) {
      for (const quantity of [1, 2, 3, 7, 12]) {
        const { totals } = line(cents / 100, vat, quantity);
        assert.equal(roundMoney(totals.totalHT + totals.taxAmount), totals.totalTTC);
        assert.equal(totals.discountAmount, 0, "no discount typed -> discountAmount is 0 (never -0.01)");
      }
    }
  }
});

test("lines with a discount: the NET UNIT price (rounded to the cent) times the quantity", () => {
  const row = line(62.5, 20, 2, 10);
  assert.equal(row.totals.totalTTC, 112.5); // (62.50 - 6.25) x 2
  assert.equal(roundMoney(row.totals.totalHT + row.totals.taxAmount), 112.5);
  assert.ok(row.totals.discountAmount > 0);

  // 33.33 % of 72.00 = 23.9976 -> 24.00 per unit, net 48.00, x 3 = 144.00
  // (the old whole-line percentage gave 144.01, a cent more than the unit price shown)
  const third = line(72, 20, 3, 33.33);
  assert.equal(third.totals.totalTTC, 144);

  const full = line(62.5, 20, 2, 100);
  assert.equal(full.totals.totalTTC, 0);
  assert.equal(full.totals.totalHT, 0);
  assert.equal(full.totals.taxAmount, 0);
});

test("discounted lines: total = round(net unit price x quantity) where the net unit price is the one displayed", () => {
  for (const ttc of [62.5, 17.5, 72, 12.99, 199.9, 45.45, 18]) {
    for (const quantity of [1, 2, 3, 5, 10, 20, 24]) {
      for (const rate of [5, 5.56, 10, 12.5, 20, 23.08, 33.33, 50]) {
        const { unitPriceTTC, totals } = line(ttc, 20, quantity, rate);
        const displayedDiscount = discountRateToUnitAmount(rate, unitPriceTTC);
        const displayedNetUnit = roundMoney(unitPriceTTC - displayedDiscount);
        assert.equal(totals.totalTTC, roundMoney(displayedNetUnit * quantity), `${ttc} x ${quantity} @ ${rate}%`);
      }
    }
  }
});

// The two conversions of components/driver-pos/driver-pos-view.tsx (guarded below).
function discountRateToUnitAmount(discountRate: number, unitPriceTTC: number) {
  return roundMoney((discountRate / 100) * unitPriceTTC);
}
function discountUnitAmountToRate(discountUnitAmount: number, unitPriceTTC: number) {
  if (unitPriceTTC <= 0) return 0;
  return Math.min(100, Math.max(0, roundMoney((discountUnitAmount / unitPriceTTC) * 100)));
}

test("REQUIRED CASE: price 18.00, discount 1.00, quantity 20 -> net unit 17.00, total 340.00 (was 339.98)", () => {
  const price = catalogue(18, 20);
  assert.equal(price.unitPriceTTC, 18);
  const rate = discountUnitAmountToRate(1, price.unitPriceTTC); // the cart stores a percentage: 5.56
  assert.equal(rate, 5.56);

  // the displayed unit price
  assert.equal(roundMoney(price.unitPriceTTC - discountRateToUnitAmount(rate, price.unitPriceTTC)), 17);
  // the old formula: 5.56 % of 360.00 = 20.02 -> 339.98, a total that disagrees with 17.00 x 20
  const grossTTC = roundMoney(price.unitPriceTTC * 20);
  assert.equal(roundMoney(grossTTC - roundMoney(grossTTC * (rate / 100))), 339.98, "the old computation reproduces the bug");

  const { totals } = line(18, 20, 20, rate);
  assert.equal(totals.totalTTC, 340);
  assert.equal(roundMoney(totals.totalHT + totals.taxAmount), 340);
  assert.equal(totals.totalHT, 283.33);
  assert.equal(totals.taxAmount, 56.67);
});

test("a DH discount typed in the cart gives exactly displayed net unit x quantity, for many prices, discounts and quantities", () => {
  for (const ttc of [18, 62.5, 17.5, 72, 12.99, 3.33, 199.9, 45.45]) {
    const price = catalogue(ttc, 20);
    for (const typed of [0.1, 0.25, 0.5, 1, 1.5, 2, 2.75, 5]) {
      if (typed > price.unitPriceTTC) continue;
      const rate = discountUnitAmountToRate(typed, price.unitPriceTTC);
      const shownDiscount = discountRateToUnitAmount(rate, price.unitPriceTTC); // what the "Rem." field shows back
      const shownNetUnit = roundMoney(price.unitPriceTTC - shownDiscount);
      for (const quantity of [1, 2, 3, 7, 12, 20, 24]) {
        const { totals } = line(ttc, 20, quantity, rate);
        assert.equal(totals.totalTTC, roundMoney(shownNetUnit * quantity), `${ttc} -${typed} x ${quantity}`);
        assert.equal(roundMoney(totals.totalHT + totals.taxAmount), totals.totalTTC);
      }
    }
  }
});

test("a commercial total is never rounded to an integer: 339.49 stays 339.49, 339.98 stays 339.98 when it is the real amount", () => {
  assert.equal(line(339.49, 20, 1).totals.totalTTC, 339.49);
  assert.equal(line(339.98, 20, 1).totals.totalTTC, 339.98);
  assert.equal(line(16.999 + 0.001, 20, 20).totals.totalTTC, 340);
});

test("the driver conversions in the cart are the ones this file mirrors", () => {
  const cart = readFileSync(new URL("../components/driver-pos/driver-pos-view.tsx", import.meta.url), "utf8");
  assert.match(cart, /function discountRateToUnitAmount\(discountRate: number, unitPriceTTC: number\): number \{\s*return round\(\(discountRate \/ 100\) \* unitPriceTTC\);/);
  assert.match(cart, /Math\.min\(100, Math\.max\(0, round\(\(discountUnitAmount \/ unitPriceTTC\) \* 100\)\)\)/);
});

test("invalid discount input is neutralised (NaN, negative, > 100)", () => {
  assert.equal(line(62.5, 20, 2, Number.NaN).totals.totalTTC, 125);
  assert.equal(line(62.5, 20, 2, -5).totals.totalTTC, 125);
  assert.equal(line(62.5, 20, 2, 250).totals.totalTTC, 0);
});

test("sale level: the sum of line HT + line VAT equals the sum of line TTC (what the API stores)", () => {
  const rows = [line(62.5, 20, 2), line(17.5, 20, 2), line(72, 20, 3, 10), line(12.99, 10, 5)];
  const subtotalHT = roundMoney(rows.reduce((sum, row) => sum + row.totals.totalHT, 0));
  const taxAmount = roundMoney(rows.reduce((sum, row) => sum + row.totals.taxAmount, 0));
  const totalTTC = roundMoney(subtotalHT + taxAmount);
  assert.equal(totalTTC, roundMoney(rows.reduce((sum, row) => sum + row.totals.totalTTC, 0)));
});

test("cart, API and offline sync use the one shared formula (no leftover HT-first computation)", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const cart = read("../components/driver-pos/driver-pos-view.tsx");
  const server = read("./server/driver-sales.ts");
  const sync = read("./offline/driver-pos/sync-payload.ts");
  for (const [name, source] of [["cart", cart], ["server", server], ["sync", sync]] as const) {
    assert.match(source, /computeDriverLineTotals\(/, `${name} uses the shared formula`);
    assert.equal(/grossHT \* \(\s*(line\.)?discountRate \/ 100\s*\)/.test(source), false, `${name} has no HT-first discount`);
  }
  // the unit TTC fed to the server formula is the one the DTO shows the driver
  assert.match(server, /verifiedUnitPriceTTC \?\? computePriceTTC\(unitPriceHT, taxRate\)/);
  assert.match(cart, /unitPriceTTC: product\.salePriceTTC/);
});

test("the web counter POS formula file is untouched (still pos-discount.ts, no driver import)", () => {
  const web = readFileSync(new URL("./pos-discount.ts", import.meta.url), "utf8");
  assert.equal(/driver-line-totals/.test(web), false);
  const posLayout = readFileSync(new URL("../components/pos/pos-layout.tsx", import.meta.url), "utf8");
  assert.equal(/driver-line-totals/.test(posLayout), false);
});

test("offline sync: a no-discount line stored with the new totals resolves to a 0 % discount (never flagged)", async () => {
  const { resolveLineDiscountRate } = await import("@/lib/offline/driver-pos/sync-payload");
  const base = {
    productId: "p",
    productNameSnapshot: "Produit",
    priceToken: null,
    discountSnapshot: 0,
  };
  for (const [ttc, quantity] of [[62.5, 2], [62.5, 12], [17.5, 2], [72, 2], [72, 24]] as const) {
    const price = catalogue(ttc, 20);
    const totals = computeDriverLineTotals({ ...price, taxRate: 20, quantity, discountRate: 0 });
    const result = resolveLineDiscountRate({
      ...base,
      quantity,
      unitPriceSnapshot: price.unitPriceTTC,
      taxRateSnapshot: 20,
      totalHT: totals.totalHT,
      taxAmount: totals.taxAmount,
      totalTTC: totals.totalTTC,
    } as never);
    assert.deepEqual(result, { ok: true, discountRate: 0 }, `${ttc} x ${quantity}`);
  }
});

test("offline sync: a discount percentage snapshotted by the cart is sent as typed", async () => {
  const { resolveLineDiscountRate } = await import("@/lib/offline/driver-pos/sync-payload");
  const price = catalogue(62.5, 20);
  const totals = computeDriverLineTotals({ ...price, taxRate: 20, quantity: 3, discountRate: 12.5 });
  const result = resolveLineDiscountRate({
    productId: "p",
    productNameSnapshot: "Produit",
    quantity: 3,
    unitPriceSnapshot: price.unitPriceTTC,
    taxRateSnapshot: 20,
    discountSnapshot: 12.5,
    totalHT: totals.totalHT,
    taxAmount: totals.taxAmount,
    totalTTC: totals.totalTTC,
    priceToken: null,
  } as never);
  assert.deepEqual(result, { ok: true, discountRate: 12.5 });
});

test("the driver ticket preview is overwritten with the cart's own line totals", () => {
  const cart = readFileSync(new URL("../components/driver-pos/driver-pos-view.tsx", import.meta.url), "utf8");
  assert.match(cart, /withDriverLineTotals\(ticketBase, cartRows\)/);
  assert.match(cart, /withDriverLineTotals\(previewSaleBase, cartRows\)/);
  // buildPreviewSale itself (shared with the web counter POS) is not edited
  const preview = readFileSync(new URL("./pos-preview-sale.ts", import.meta.url), "utf8");
  assert.equal(/driver-line-totals/.test(preview), false);
});
