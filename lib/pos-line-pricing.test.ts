import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { roundMoney } from "@/lib/money";
import { computeDiscountedLineTotals, unitPriceTTCFromHT } from "@/lib/pos-discount";
import { buildPreviewSale } from "@/lib/pos-preview-sale";
import { receiptUnitPriceTTC } from "@/lib/receipt-line-price";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Exact reference in integer cents: net unit (cents) x quantity, no float. */
function referenceTotalCents(unitTTCCents: number, discountCents: number, quantity: number) {
  return (unitTTCCents - discountCents) * quantity;
}

const counterLine = (unitPriceHT: number, taxRate: number, quantity: number, discountUnitAmount: number) =>
  computeDiscountedLineTotals({ unitPriceHT, taxRate, quantity, discountUnitAmount });

// ---- the required case on the counter POS ------------------------------------------------------------

test("REQUIRED CASE (counter POS): 18.00 TTC - 1.00 = 17.00 net, x 20 = 340.00", () => {
  // 18.00 TTC at 20 % VAT is 15.00 HT
  assert.equal(unitPriceTTCFromHT(15, 20), 18);
  const totals = counterLine(15, 20, 20, 1);
  assert.equal(totals.totalTTC, 340);
  assert.equal(totals.totalHT, 283.33);
  assert.equal(totals.taxAmount, 56.67);
  assert.equal(roundMoney(totals.totalHT + totals.taxAmount), 340);
  assert.equal(totals.discountUnitAmount, 1);
});

test("the net unit price is rounded to the cent BEFORE the quantity is applied", () => {
  // a typed discount with more than 2 decimals must not leak into the total: 18.00 - 1.004 -> 17.00 x 20
  const { totalTTC } = counterLine(15, 20, 20, 1.004);
  assert.equal(totalTTC, roundMoney(roundMoney(18 - 1.004) * 20));
  assert.equal(totalTTC, 340);
  // 17.9990000001-style float noise never reaches the total
  assert.equal(counterLine(14.999, 20, 20, 1).totalTTC, 340);
});

test("totals equal the exact integer-cent reference for many prices, discounts and quantities", () => {
  for (const unitHT of [15, 12.5, 8.33, 41.67, 0.83, 100, 3.49]) {
    for (const taxRate of [0, 7, 10, 14, 20]) {
      const unitTTC = unitPriceTTCFromHT(unitHT, taxRate);
      const unitTTCCents = Math.round(unitTTC * 100);
      for (const discount of [0, 0.01, 0.1, 0.33, 0.5, 1, 1.25, 2.5]) {
        if (discount > unitTTC) continue;
        const discountCents = Math.round(discount * 100);
        for (const quantity of [1, 2, 3, 6, 12, 20, 24, 100]) {
          const { totalTTC, totalHT, taxAmount } = counterLine(unitHT, taxRate, quantity, discount);
          assert.equal(
            Math.round(totalTTC * 100),
            referenceTotalCents(unitTTCCents, discountCents, quantity),
            `HT ${unitHT} VAT ${taxRate} -${discount} x ${quantity}`,
          );
          assert.equal(roundMoney(totalHT + taxAmount), totalTTC, "HT + VAT = TTC");
        }
      }
    }
  }
});

test("a discount can never exceed the unit price nor make a negative total", () => {
  assert.equal(counterLine(15, 20, 20, 50).totalTTC, 0);
  assert.equal(counterLine(15, 20, 20, -3).totalTTC, 360);
  assert.equal(counterLine(15, 20, 20, Number.NaN).totalTTC, 360);
});

test("real amounts are NOT rounded to an integer: 339.49 and 339.50 stay as they are", () => {
  for (const amount of [339.49, 339.5, 340.01, 339.98]) {
    const unitHT = roundMoney(amount / 1.2);
    const unitTTC = unitPriceTTCFromHT(unitHT, 20);
    assert.equal(counterLine(unitHT, 20, 1, 0).totalTTC, unitTTC);
    assert.ok(Math.abs(unitTTC - amount) < 0.011, `${amount} -> ${unitTTC}`);
    assert.notEqual(Number.isInteger(unitTTC), true, `${amount} was not turned into an integer`);
  }
});

// ---- the printed ticket --------------------------------------------------------------------------------

test("ticket: the printed unit price x quantity equals the printed line total, with and without discount", () => {
  for (const [unitHT, taxRate, quantity, discount] of [
    [15, 20, 20, 1],
    [15, 20, 20, 0],
    [12.5, 20, 7, 0.5],
    [8.33, 10, 12, 0],
    [41.67, 14, 3, 2.5],
    [14.99, 20, 20, 0], // 17.988 TTC: the unrounded value used to be printed
    [14.99, 20, 20, 1],
  ] as const) {
    const totals = counterLine(unitHT, taxRate, quantity, discount);
    const printedUnit = receiptUnitPriceTTC({ unitPriceHT: unitHT, taxRate, quantity, totalTTC: totals.totalTTC });
    assert.equal(roundMoney(printedUnit * quantity), totals.totalTTC, `${unitHT}/${taxRate}/${quantity}/-${discount}`);
    assert.equal(printedUnit, roundMoney(printedUnit), "printed on exact cents");
  }
  const required = counterLine(15, 20, 20, 1);
  assert.equal(receiptUnitPriceTTC({ unitPriceHT: 15, taxRate: 20, quantity: 20, totalTTC: required.totalTTC }), 17);
});

test("ticket: the preview sale carries 340.00 whatever the payment method (cash, card, cheque, transfer, mixed, credit)", () => {
  for (const paymentMethod of ["CASH", "CARD", "CHEQUE", "BANK_TRANSFER", "MIXED", "CREDIT"]) {
    const sale = buildPreviewSale({
      displayNumber: "1/2026",
      createdByUserName: "Test",
      paymentMethod,
      lines: [
        {
          productId: "p1",
          productReference: "R1",
          productName: "Produit 18 DH",
          quantity: 20,
          unitPriceHT: 15,
          discountUnitAmount: 1,
          taxRate: 20,
        },
      ],
    });
    assert.equal(sale.lines[0].totalTTC, 340, paymentMethod);
    assert.equal(sale.totalTTC, 340, paymentMethod);
    assert.equal(sale.roundingAmount, 0);
    assert.equal(sale.creditAmount, 340, "nothing collected yet: the whole total is still due");
    assert.equal(sale.paymentMethod, paymentMethod);
    assert.equal(roundMoney(sale.subtotalHT - sale.discountAmount + sale.taxAmount), 340);
  }
});

test("ticket: several lines add up at the cent, then the FINAL total is rounded to 0.50", () => {
  const sale = buildPreviewSale({
    displayNumber: "2/2026",
    createdByUserName: "Test",
    paymentMethod: "CASH",
    lines: [
      { productId: "a", productReference: "A", productName: "A", quantity: 20, unitPriceHT: 15, discountUnitAmount: 1, taxRate: 20 },
      { productId: "b", productReference: "B", productName: "B", quantity: 7, unitPriceHT: 12.5, discountUnitAmount: 0.5, taxRate: 20 },
      { productId: "c", productReference: "C", productName: "C", quantity: 3, unitPriceHT: 8.33, discountUnitAmount: 0, taxRate: 10 },
    ],
  });
  assert.deepEqual(
    sale.lines.map((line) => line.totalTTC),
    [340, 7 * 14.5, 3 * 9.16], // 15.00-> 18 - 1 ; 12.5 -> 15 - 0.5 ; 8.33 x 1.1 = 9.163 -> 9.16
  );
  // lines stay at the cent: 340.00 + 101.50 + 27.48 = 468.98 -> final total 469.00 (+0.02)
  assert.equal(roundMoney(sale.lines.reduce((sum, line) => sum + line.totalTTC, 0)), 468.98);
  assert.equal(sale.totalTTC, 469);
  assert.equal(sale.roundingAmount, 0.02);
});

// ---- the stored data and the other money rules are untouched ----------------------------------------------

test("only the calculation changed: stored discount columns and accounting code are not edited", () => {
  const driverTotals = read("./driver-line-totals.ts");
  assert.match(driverTotals, /const netUnitPriceTTC = roundMoney\(unitPriceTTC - discountUnitAmount\);/);
  assert.match(driverTotals, /const totalTTC = roundMoney\(netUnitPriceTTC \* quantity\);/);
  // the percentage is still what is stored and sent
  assert.match(read("./server/driver-sales.ts"), /discountRate,\s*\n\s*discountAmount,/);
  // the counter formula keeps its order
  const counter = read("./pos-discount.ts");
  assert.match(counter, /const netUnitPriceTTC = roundMoney\(unitPriceTTC - clampedDiscountUnitAmount\);\s*\n\s*const totalTTC = roundMoney\(quantity \* netUnitPriceTTC\);/);
  // no integer snapping anywhere in the line pricing
  for (const source of [driverTotals, counter, read("./receipt-line-price.ts")]) {
    assert.equal(/Math\.round\((total|net)/.test(source), false);
  }
  // accounting is not involved
  assert.equal(/accounting/i.test(driverTotals.replace(/\/\*[\s\S]*?\*\//g, "")), false);
});
