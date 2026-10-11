import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISCOUNT_INDICATOR_ROLES,
  canSeeDiscountIndicator,
  computeInvoiceDiscount,
  type InvoiceDiscountLine,
} from "./sale-discount-indicator";

const line = (over: Partial<InvoiceDiscountLine> = {}): InvoiceDiscountLine => ({
  discountAmount: 0,
  taxRate: 20,
  quantity: 1,
  unitPriceHT: 20,
  totalTTC: 24,
  ...over,
});

test("roles: admin, super_admin and cashier may see the indicator; driver, depot manager and anything unknown may not", () => {
  assert.deepEqual([...DISCOUNT_INDICATOR_ROLES], ["super_admin", "admin", "cashier"]);
  for (const role of ["super_admin", "admin", "cashier"]) assert.equal(canSeeDiscountIndicator(role), true, role);
  for (const role of ["driver", "depot_manager", "DRIVER", "CHAUFFEUR", "", "ADMIN", undefined, null]) {
    assert.equal(canSeeDiscountIndicator(role as string | undefined | null), false, String(role));
  }
});

test("no stored line discount -> no indicator, whatever the totals", () => {
  assert.deepEqual(computeInvoiceDiscount({ lines: [] }), { hasDiscount: false, amountTTC: 0 });
  assert.deepEqual(computeInvoiceDiscount({ lines: [line(), line()] }), { hasDiscount: false, amountTTC: 0 });
});

test("a historical invoice is never flagged because its total looks low: only a STORED line discount can start a flag", () => {
  // catalogue price TTC 24.00, SOLD for 18.00 (price edit, old tariff...) but NO stored discount -> not a discount
  assert.equal(computeInvoiceDiscount({ lines: [line({ totalTTC: 18 })] }).hasDiscount, false);
  assert.equal(computeInvoiceDiscount({ lines: [line({ unitPriceHT: 10, totalTTC: 1 })] }).hasDiscount, false);
  // the same low total WITH a stored discount is flagged
  assert.equal(computeInvoiceDiscount({ lines: [line({ discountAmount: 5, totalTTC: 18 })] }).hasDiscount, true);
});

test("a one-cent HT rounding difference is NOT a discount (real case: 2 x 5.00 TTC sold with a stored 0.01)", () => {
  // HT 4.17 x 2 = 8.34 while 10.00 TTC / 1.2 = 8.33: the stored discount is 0.01, the customer paid the full price
  const rounding = line({ discountAmount: 0.01, quantity: 2, unitPriceHT: 4.17, totalTTC: 10 });
  assert.deepEqual(computeInvoiceDiscount({ lines: [rounding] }), { hasDiscount: false, amountTTC: 0 });
  // many such lines do not add up to a discount either
  assert.equal(computeInvoiceDiscount({ lines: [rounding, rounding, rounding] }).hasDiscount, false);
  // but a really typed discount on the same product is flagged
  assert.equal(computeInvoiceDiscount({ lines: [line({ discountAmount: 0.84, quantity: 1, unitPriceHT: 4.17, totalTTC: 4 })] }).hasDiscount, true);
});

test("the amount is the discount as typed in DH at the POS (not a rounded HT conversion)", () => {
  // 1.00 DH off a 5.00 DH unit: the stored HT discount is 0.84 (0.84 x 1.2 = 1.008 would read 1.01)
  assert.deepEqual(computeInvoiceDiscount({ lines: [line({ discountAmount: 0.84, unitPriceHT: 4.17, totalTTC: 4 })] }), { hasDiscount: true, amountTTC: 1 });
  // 1 DH per unit x 3 units
  assert.equal(computeInvoiceDiscount({ lines: [line({ discountAmount: 2.5, quantity: 3, unitPriceHT: 16.67, totalTTC: 57 })] }).amountTTC, 3);
});

test("several lines: only the discounted ones count, each with its own VAT; a non-discounted line adds nothing", () => {
  const result = computeInvoiceDiscount({
    lines: [
      line({ discountAmount: 0.83, unitPriceHT: 20, totalTTC: 23 }), // 24.00 -> 23.00 : 1.00
      line({ discountAmount: 1.67, taxRate: 10, unitPriceHT: 20, quantity: 1, totalTTC: 20.16 }), // 22.00 -> 20.16 : 1.84
      line({ unitPriceHT: 20, totalTTC: 24 }), // not discounted
    ],
  });
  assert.equal(result.hasDiscount, true);
  assert.equal(result.amountTTC, 2.84);
});

test("an old percentage discount is read as the DH it amounted to", () => {
  // 2 x 12.00 TTC, 10% off -> total 21.60: 1.20 DH per unit, 2.40 DH in all (HT discount stored: 2.00)
  assert.equal(computeInvoiceDiscount({ lines: [line({ discountAmount: 2, quantity: 2, unitPriceHT: 10, totalTTC: 21.6 })] }).amountTTC, 2.4);
});

test("an inconsistent row (stored discount but a total equal to the price) is not flagged: nothing shows a discount was given", () => {
  assert.deepEqual(computeInvoiceDiscount({ lines: [line({ discountAmount: 0.5, totalTTC: 24 })] }), { hasDiscount: false, amountTTC: 0 });
});

test("the smallest real discount (0.01 DH off the unit price) is flagged, and amounts are rounded to the cent", () => {
  assert.deepEqual(computeInvoiceDiscount({ lines: [line({ discountAmount: 0.01, totalTTC: 23.99 })] }), { hasDiscount: true, amountTTC: 0.01 });
  assert.equal(computeInvoiceDiscount({ lines: [line({ discountAmount: 0.01, taxRate: 0, unitPriceHT: 10, totalTTC: 9.99 })] }).amountTTC, 0.01);
});
