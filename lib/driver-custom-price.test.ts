import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeDriverLineTotals, priceFromCustomTTC } from "@/lib/driver-line-totals";

describe("driver POS - the price the driver types for a line", () => {
  it("the typed TTC price IS the unit price, the HT price is derived from it", () => {
    assert.deepEqual(priceFromCustomTTC(15, 20), { unitPriceTTC: 15, unitPriceHT: 12.5 });
    assert.deepEqual(priceFromCustomTTC(62.5, 20), { unitPriceTTC: 62.5, unitPriceHT: 52.08 });
    assert.deepEqual(priceFromCustomTTC(10, 0), { unitPriceTTC: 10, unitPriceHT: 10 });
  });

  it("0 DH is a price: free line, amounts at 0, never the catalogue price", () => {
    assert.deepEqual(priceFromCustomTTC(0, 20), { unitPriceTTC: 0, unitPriceHT: 0 });
    const totals = computeDriverLineTotals({ unitPriceHT: 0, unitPriceTTC: 0, taxRate: 20, quantity: 5, discountRate: 0 });
    assert.deepEqual(totals, { grossHT: 0, discountAmount: 0, totalHT: 0, taxAmount: 0, totalTTC: 0 });
  });

  it("a typed price to the cent is billed to the cent (no drift between the price shown and the line total)", () => {
    for (const typed of [0.01, 1.01, 2.01, 7.77, 15.55, 99.99, 1250.5]) {
      const price = priceFromCustomTTC(typed, 20);
      assert.equal(price.unitPriceTTC, typed, `${typed} stays ${typed}`);
      const line = computeDriverLineTotals({ ...price, taxRate: 20, quantity: 3, discountRate: 0 });
      assert.equal(line.totalTTC, Math.round(typed * 3 * 100) / 100, `${typed} x 3`);
      assert.equal(Math.round((line.totalHT + line.taxAmount) * 100) / 100, line.totalTTC, `${typed}: HT + VAT = TTC`);
    }
  });

  it("the discount applies on top of the typed price, the line total follows", () => {
    const price = priceFromCustomTTC(15, 20);
    // 10 % off 15.00 = 1.50 per unit -> 13.50 x 4 = 54.00
    const line = computeDriverLineTotals({ ...price, taxRate: 20, quantity: 4, discountRate: 10 });
    assert.equal(line.totalTTC, 54);
  });

  it("the sale total is the sum of the typed lines (typed 15 x 2 + catalogue 20 x 1 + free x 3)", () => {
    const typed = computeDriverLineTotals({ ...priceFromCustomTTC(15, 20), taxRate: 20, quantity: 2, discountRate: 0 });
    const catalogue = computeDriverLineTotals({ unitPriceHT: 16.67, unitPriceTTC: 20, taxRate: 20, quantity: 1, discountRate: 0 });
    const free = computeDriverLineTotals({ ...priceFromCustomTTC(0, 20), taxRate: 20, quantity: 3, discountRate: 0 });
    assert.equal(typed.totalTTC + catalogue.totalTTC + free.totalTTC, 50);
  });
});
