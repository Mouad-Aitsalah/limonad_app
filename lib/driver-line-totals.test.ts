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

test("lines with a discount (percentage rule unchanged): TTC gross minus the rounded percentage", () => {
  const row = line(62.5, 20, 2, 10);
  assert.equal(row.totals.totalTTC, 112.5); // 125.00 - 12.50
  assert.equal(roundMoney(row.totals.totalHT + row.totals.taxAmount), 112.5);
  assert.ok(row.totals.discountAmount > 0);

  const third = line(72, 20, 3, 33.33);
  assert.equal(third.totals.totalTTC, roundMoney(216 - roundMoney(216 * 0.3333)));

  const full = line(62.5, 20, 2, 100);
  assert.equal(full.totals.totalTTC, 0);
  assert.equal(full.totals.totalHT, 0);
  assert.equal(full.totals.taxAmount, 0);
});

test("discounted lines stay within 1 cent of the exact amount (displayed unit TTC x quantity x (1 - rate))", () => {
  let worst = 0;
  for (const ttc of [62.5, 17.5, 72, 12.99, 199.9, 45.45]) {
    for (const quantity of [1, 2, 3, 5, 10, 24]) {
      for (const rate of [5, 10, 12.5, 20, 23.08, 33.33, 50]) {
        const { unitPriceTTC, totals } = line(ttc, 20, quantity, rate);
        const exact = unitPriceTTC * quantity * (1 - rate / 100);
        worst = Math.max(worst, Math.abs(totals.totalTTC - exact));
      }
    }
  }
  assert.ok(worst <= 0.0100001, `max difference ${worst}`);
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
