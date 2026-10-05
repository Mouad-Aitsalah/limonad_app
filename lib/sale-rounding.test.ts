import assert from "node:assert/strict";
import { test } from "node:test";

import { roundMoney } from "@/lib/money";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import {
  applyCommercialRounding,
  computeSaleTotals,
  roundToHalfDirham,
} from "@/lib/sale-rounding";

// ---- the eight required cases -------------------------------------------------------------------------

const CASES: Array<[before: number, final: number, rounding: number]> = [
  [339.49, 339.5, 0.01],
  [339.5, 339.5, 0],
  [339.51, 339.5, -0.01],
  [339.74, 339.5, -0.24],
  [339.75, 340, 0.25],
  [339.98, 340, 0.02],
  [340.24, 340, -0.24],
  [340.25, 340.5, 0.25],
];

for (const [before, final, rounding] of CASES) {
  test(`${before.toFixed(2)} -> ${final.toFixed(2)} (roundingAmount ${rounding >= 0 ? "+" : ""}${rounding.toFixed(2)})`, () => {
    assert.equal(roundToHalfDirham(before), final);
    const result = applyCommercialRounding(before);
    assert.equal(result.totalTTC, final);
    assert.equal(result.roundingAmount, rounding);
    assert.equal(result.totalBeforeRounding, before);
    // the explicit difference reconstructs the total exactly
    assert.equal(roundMoney(result.totalBeforeRounding + result.roundingAmount), result.totalTTC);
  });
}

// ---- the example of the request ------------------------------------------------------------------------

test("18.00 - 1.00 = 17.00 net, x 20 = 340.00: no rounding difference at all", () => {
  const line = computeDiscountedLineTotals({ unitPriceHT: 15, taxRate: 20, quantity: 20, discountUnitAmount: 1 });
  assert.equal(line.totalTTC, 340);
  const totals = computeSaleTotals([line]);
  assert.equal(totals.totalBeforeRounding, 340);
  assert.equal(totals.roundingAmount, 0);
  assert.equal(totals.totalTTC, 340);
  // HT and VAT are the real line values, untouched
  assert.equal(totals.subtotalHT, 283.33);
  assert.equal(totals.taxAmount, 56.67);
  assert.equal(roundMoney(totals.subtotalHT + totals.taxAmount + totals.roundingAmount), totals.totalTTC);
});

// ---- exactness / edge cases -----------------------------------------------------------------------------

test("every multiple of 0.25 around the thresholds rounds exactly (no binary-float drift)", () => {
  for (let cents = 0; cents <= 100000; cents += 1) {
    const amount = cents / 100;
    const rounded = roundToHalfDirham(amount);
    // result is a multiple of 0.50
    assert.equal(Math.round(rounded * 100) % 50, 0, String(amount));
    // never more than 0.25 away
    assert.ok(Math.abs(roundMoney(rounded - amount)) <= 0.25, String(amount));
    // ties (x.25 / x.75) go up
    if (cents % 50 === 25) assert.equal(roundMoney(rounded - amount), 0.25, `tie ${amount}`);
  }
});

test("zero and tiny amounts, negative totals (returns) and -0 are handled", () => {
  assert.equal(roundToHalfDirham(0), 0);
  assert.equal(Object.is(roundToHalfDirham(0), 0), true);
  assert.equal(roundToHalfDirham(0.24), 0);
  assert.equal(Object.is(roundToHalfDirham(0.24), 0), true);
  assert.equal(roundToHalfDirham(0.25), 0.5);
  assert.equal(roundToHalfDirham(-0.24), 0);
  assert.equal(Object.is(roundToHalfDirham(-0.1), 0), true, "-0 normalised");
  assert.equal(roundToHalfDirham(-339.75), -340, "symmetric (half away from zero)");
  assert.equal(roundToHalfDirham(-339.49), -339.5);
});

test("large amounts stay exact", () => {
  assert.equal(roundToHalfDirham(9999999999.99), 10000000000);
  assert.equal(roundToHalfDirham(1234567.26), 1234567.5);
  assert.equal(roundToHalfDirham(1234567.24), 1234567);
});

test("a non finite amount is refused", () => {
  assert.throws(() => roundToHalfDirham(Number.NaN));
  assert.throws(() => roundToHalfDirham(Number.POSITIVE_INFINITY));
});

test("the unit price and the lines are NOT rounded to 0.50: only the sale total is", () => {
  // 17.25 and 17.49 stay at the cent; a 3-line sale rounds ONCE at the end
  const lines = [
    computeDiscountedLineTotals({ unitPriceHT: 14.375, taxRate: 20, quantity: 1, discountUnitAmount: 0 }), // 17.25 TTC
    computeDiscountedLineTotals({ unitPriceHT: 14.575, taxRate: 20, quantity: 1, discountUnitAmount: 0 }), // 17.49 TTC
  ];
  assert.deepEqual(
    lines.map((line) => line.totalTTC),
    [17.25, 17.49],
  );
  const totals = computeSaleTotals(lines);
  assert.equal(totals.totalBeforeRounding, 34.74);
  assert.equal(totals.totalTTC, 34.5);
  assert.equal(totals.roundingAmount, -0.24);
});

test("computeSaleTotals: HT, VAT, discount are plain sums of the lines; rounding only on HT + VAT", () => {
  const lines = [
    { totalHT: 100.03, taxAmount: 20.01, discountAmount: 1 },
    { totalHT: 50.01, taxAmount: 10, discountAmount: 0.5 },
  ];
  const totals = computeSaleTotals(lines);
  assert.equal(totals.subtotalHT, 150.04);
  assert.equal(totals.taxAmount, 30.01);
  assert.equal(totals.discountAmount, 1.5);
  assert.equal(totals.totalBeforeRounding, 180.05);
  assert.equal(totals.totalTTC, 180);
  assert.equal(totals.roundingAmount, -0.05);
});

test("rounding mode NONE keeps the legacy cent total (queued offline sale)", () => {
  const totals = computeSaleTotals([{ totalHT: 283.33, taxAmount: 56.66 }], "NONE");
  assert.equal(totals.totalBeforeRounding, 339.99);
  assert.equal(totals.totalTTC, 339.99);
  assert.equal(totals.roundingAmount, 0);
  assert.deepEqual(applyCommercialRounding(339.49, "NONE"), {
    totalBeforeRounding: 339.49,
    roundingAmount: 0,
    totalTTC: 339.49,
  });
});

test("an empty sale is 0 with no rounding", () => {
  const totals = computeSaleTotals([]);
  assert.deepEqual(totals, {
    subtotalHT: 0,
    discountAmount: 0,
    taxAmount: 0,
    totalBeforeRounding: 0,
    roundingAmount: 0,
    totalTTC: 0,
  });
});
