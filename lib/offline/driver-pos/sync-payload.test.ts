import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeDriverLineTotals, priceFromCustomTTC } from "@/lib/driver-line-totals";
import { roundMoney } from "@/lib/money";

import { buildSyncPayload, resolveLineDiscountRate } from "./sync-payload";
import type { OfflineSaleWithLines } from "./types";

type Line = OfflineSaleWithLines["lines"][number];

/**
 * An offline sale line exactly as the driver cart stores it (driver-pos-view.tsx): the totals come from the
 * shared TTC-first formula (lib/driver-line-totals.ts), `discountSnapshot` is the percentage typed in the cart.
 * `catalogueHT` is the catalogue price (stored HT with 2 decimals), `custom` a price the driver typed (TTC).
 */
function cartLine(options: { catalogueHT: number; taxRate: number; quantity: number; discountRate?: number; custom?: number; snapshot?: number }): Line {
  const unitPriceTTC = roundMoney(options.catalogueHT * (1 + options.taxRate / 100));
  const price =
    options.custom === undefined
      ? { unitPriceHT: options.catalogueHT, unitPriceTTC }
      : priceFromCustomTTC(options.custom, options.taxRate);
  const totals = computeDriverLineTotals({
    ...price,
    taxRate: options.taxRate,
    quantity: options.quantity,
    discountRate: options.discountRate ?? 0,
  });
  return {
    id: "l",
    offlineSaleId: "s",
    productId: "p",
    productNameSnapshot: "Produit",
    quantity: options.quantity,
    unitPriceSnapshot: unitPriceTTC,
    taxRateSnapshot: options.taxRate,
    discountSnapshot: options.snapshot ?? options.discountRate ?? 0,
    totalHT: totals.totalHT,
    taxAmount: totals.taxAmount,
    totalTTC: totals.totalTTC,
    priceToken: "signed",
    ...(options.custom === undefined ? {} : { customUnitPriceTTC: options.custom }),
  } as Line;
}

describe("offline sync - a line with no discount is never refused", () => {
  it("the cases that used to be refused: 20 DH x 2, 5 DH x 2, 5 DH x 5 (20 % VAT)", () => {
    for (const [ttc, quantity] of [[20, 2], [5, 2], [5, 5]] as const) {
      const catalogueHT = roundMoney(ttc / 1.2);
      const line = cartLine({ catalogueHT, taxRate: 20, quantity });
      assert.equal(line.discountSnapshot, 0);
      assert.deepEqual(resolveLineDiscountRate(line), { ok: true, discountRate: 0 }, `${ttc} x ${quantity}`);
    }
  });

  it("20 DH x 2 is the one a driver reported: the stored totals are 33.33 HT / 40 TTC, the HT gross is 33.34", () => {
    const line = cartLine({ catalogueHT: 16.67, taxRate: 20, quantity: 2 });
    assert.deepEqual([line.totalHT, line.totalTTC], [33.33, 40]);
    assert.deepEqual(resolveLineDiscountRate(line), { ok: true, discountRate: 0 });
  });

  it("sweep: every catalogue price x quantity 1..30 x VAT (0, 7, 10, 14, 20 %) is accepted with a 0 % discount", () => {
    let checked = 0;
    for (const taxRate of [0, 7, 10, 14, 20]) {
      for (let cents = 100; cents <= 20_000; cents += 137) {
        const catalogueHT = cents / 100;
        for (let quantity = 1; quantity <= 30; quantity += 1) {
          const line = cartLine({ catalogueHT, taxRate, quantity });
          const result = resolveLineDiscountRate(line);
          assert.deepEqual(result, { ok: true, discountRate: 0 }, `HT ${catalogueHT} x ${quantity} @ ${taxRate} %`);
          checked += 1;
        }
      }
    }
    assert.ok(checked > 20_000, `${checked} combinations`);
  });

  it("sweep with a price typed by the driver (0 DH included): accepted with a 0 % discount", () => {
    for (const taxRate of [0, 10, 20]) {
      for (const custom of [0, 0.01, 1.01, 2.01, 7.77, 12, 15, 15.5, 19.99, 99.99, 1250.5]) {
        for (let quantity = 1; quantity <= 15; quantity += 1) {
          const line = cartLine({ catalogueHT: 16.67, taxRate, quantity, custom });
          assert.deepEqual(resolveLineDiscountRate(line), { ok: true, discountRate: 0 }, `${custom} x ${quantity} @ ${taxRate} %`);
        }
      }
    }
  });

  it("a line saved with an explicit 0 snapshot reaches the server as a 0 % line in the sync body", () => {
    const line = cartLine({ catalogueHT: 16.67, taxRate: 20, quantity: 2 });
    const sale = { localId: "l", clientMutationId: "11111111-1111-4111-8111-111111111111", localReference: "OFF-1", soldAt: "2026-10-14T10:00:00.000Z", customerId: null, paymentMethod: "CASH", totalTTC: 40, roundingAmount: 0, lines: [line] } as unknown as OfflineSaleWithLines;
    const result = buildSyncPayload(sale);
    assert.ok(result.ok);
    assert.equal(result.body.lines[0].discountRate, 0);
    assert.equal(result.body.expectedTotalTTC, 40);
  });
});

describe("offline sync - discounts are still read correctly", () => {
  it("an explicit discount snapshot is sent as is", () => {
    for (const discountRate of [0.5, 5, 10, 33.33, 100]) {
      const line = cartLine({ catalogueHT: 16.67, taxRate: 20, quantity: 3, discountRate });
      assert.deepEqual(resolveLineDiscountRate(line), { ok: true, discountRate });
    }
  });

  it("a LEGACY discounted line (discount applied to the totals but snapshot 0) is still reconstructed and verified", () => {
    for (const [catalogueHT, quantity, discountRate] of [[16.67, 3, 10], [83.33, 2, 5], [8.33, 12, 25]] as const) {
      const line = cartLine({ catalogueHT, taxRate: 20, quantity, discountRate, snapshot: 0 });
      assert.equal(line.discountSnapshot, 0);
      const result = resolveLineDiscountRate(line);
      assert.ok(result.ok, `${catalogueHT} x ${quantity} -${discountRate} %`);
      if (result.ok) {
        // whatever percentage is rebuilt must reproduce the stored amounts to the cent
        const check = computeDriverLineTotals({
          unitPriceHT: roundMoney(line.unitPriceSnapshot / 1.2),
          unitPriceTTC: line.unitPriceSnapshot,
          taxRate: 20,
          quantity,
          discountRate: result.discountRate,
        });
        assert.ok(Math.abs(check.totalTTC - line.totalTTC) <= 0.01);
        assert.ok(Math.abs(check.totalHT - line.totalHT) <= 0.01);
        assert.ok(result.discountRate > 0);
      }
    }
  });

  it("unchanged limit: a legacy line (snapshot 0) whose discount cannot be rebuilt to the cent still goes to manual review", () => {
    // 41.67 HT x 4 at -50 % (a sale saved before the discount was recorded): the same answer as before the fix
    const line = cartLine({ catalogueHT: 41.67, taxRate: 20, quantity: 4, discountRate: 50, snapshot: 0 });
    const result = resolveLineDiscountRate(line);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /verification manuelle requise/);
  });

  it("totals that match no discount at all are still reported for manual review, never guessed", () => {
    const line = { ...cartLine({ catalogueHT: 16.67, taxRate: 20, quantity: 2 }), totalHT: 20, taxAmount: 4, totalTTC: 24.01 } as Line;
    const result = resolveLineDiscountRate(line);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /verification manuelle requise/);
  });

  it("an impossible snapshot is refused", () => {
    for (const discountSnapshot of [-1, 101, Number.NaN]) {
      const line = { ...cartLine({ catalogueHT: 16.67, taxRate: 20, quantity: 1 }), discountSnapshot } as Line;
      assert.equal(resolveLineDiscountRate(line).ok, false, String(discountSnapshot));
    }
  });

  it("a free line (0 DH) needs no reconstruction", () => {
    assert.deepEqual(resolveLineDiscountRate(cartLine({ catalogueHT: 16.67, taxRate: 20, quantity: 4, custom: 0 })), { ok: true, discountRate: 0 });
  });
});
