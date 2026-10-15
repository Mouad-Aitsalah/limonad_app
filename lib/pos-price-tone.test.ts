import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PRICE_TONE_CLASS, priceTone, type PriceTone } from "@/lib/pos-price-tone";

const tone = (applied: number | null | undefined, original: number | null | undefined, purchase: number | null | undefined): PriceTone =>
  priceTone({ applied, original, purchase });

describe("price colour - purchase price 12 DH, usual price 20 DH", () => {
  const cases: Array<[number, PriceTone]> = [
    [25, "above"],
    [20.01, "above"],
    [15, "between"],
    [12.01, "between"],
    [12, "below"],
    [5, "below"],
    [0, "below"],
    [20, "neutral"],
  ];
  for (const [applied, expected] of cases) {
    it(`${applied} DH -> ${expected}`, () => {
      assert.equal(tone(applied, 20, 12), expected);
    });
  }
});

describe("price colour - edge cases", () => {
  it("purchase price = usual price: no orange zone (red below or at, neutral at the usual price, green above)", () => {
    assert.equal(tone(25, 20, 20), "above");
    assert.equal(tone(20, 20, 20), "neutral", "the usual price itself stays neutral, even when it equals the cost");
    assert.equal(tone(19.99, 20, 20), "below");
    assert.equal(tone(5, 20, 20), "below");
    assert.equal(tone(0, 20, 20), "below");
  });

  it("usual price under the purchase price (bad data): the cost is a floor - at or under it is red, never green", () => {
    assert.equal(tone(14, 10, 15), "below");
    assert.equal(tone(15, 10, 15), "below");
    assert.equal(tone(16, 10, 15), "above");
    assert.equal(tone(10, 10, 15), "neutral");
  });

  it("purchase price unavailable: neutral, no cost is invented - except 0 DH, which is at or under any cost", () => {
    for (const purchase of [null, undefined, Number.NaN, -1]) {
      assert.equal(tone(25, 20, purchase), "neutral");
      assert.equal(tone(15, 20, purchase), "neutral");
      assert.equal(tone(1, 20, purchase), "neutral");
      assert.equal(tone(0, 20, purchase), "below");
    }
  });

  it("usual price unavailable: only the cost can speak (red at or under it), otherwise neutral", () => {
    for (const original of [null, undefined, Number.NaN]) {
      assert.equal(tone(12, original, 12), "below");
      assert.equal(tone(5, original, 12), "below");
      assert.equal(tone(0, original, 12), "below");
      assert.equal(tone(15, original, 12), "neutral");
      assert.equal(tone(25, original, 12), "neutral");
    }
  });

  it("nothing is known: neutral, and a price of 0 is still red", () => {
    assert.equal(tone(5, null, null), "neutral");
    assert.equal(tone(0, null, null), "below");
  });

  it("a missing / invalid applied price is neutral, never an error", () => {
    assert.equal(tone(null, 20, 12), "neutral");
    assert.equal(tone(undefined, 20, 12), "neutral");
    assert.equal(tone(Number.NaN, 20, 12), "neutral");
    assert.equal(tone(-1, 20, 12), "neutral");
  });

  it("amounts are compared to the cent: 20.004 is the usual price, 12.004 is the cost", () => {
    assert.equal(tone(20.004, 20, 12), "neutral");
    assert.equal(tone(12.004, 20, 12), "below");
    assert.equal(tone(12.006, 20, 12), "between");
  });

  it("the colour follows the price immediately: each change recomputes it", () => {
    assert.deepEqual([25, 15, 12, 0, 20].map((applied) => tone(applied, 20, 12)), ["above", "between", "below", "below", "neutral"]);
  });

  it("each colour has its own look; neutral has none (the usual look is kept)", () => {
    assert.match(PRICE_TONE_CLASS.above, /emerald/);
    assert.match(PRICE_TONE_CLASS.between, /orange/);
    assert.match(PRICE_TONE_CLASS.below, /red/);
    assert.equal(Object.keys(PRICE_TONE_CLASS).includes("neutral"), false);
  });
});
