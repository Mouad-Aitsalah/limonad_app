import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptPriceText,
  formatPriceText,
  IDLE_PRICE_FIELD,
  parsePriceText,
  priceFieldBlur,
  priceFieldChange,
  priceFieldFocus,
  priceFieldText,
  settlePriceText,
  type PriceFieldState,
} from "@/lib/pos-price-input";

/**
 * The operator's side of the price field, driven the way the component drives it: a parent that stores the
 * applied price (and, like pos-layout / driver-pos-view, applies whatever number it is given - no `||`
 * fallback to the catalogue price), and the field state machine in between.
 */
function field(initial: number) {
  const parent = { applied: initial, calls: [] as number[], renders: 0 };
  let state: PriceFieldState = IDLE_PRICE_FIELD;
  const apply = (emit: number | null) => {
    if (emit === null) return;
    parent.calls.push(emit);
    parent.applied = emit;
  };
  return {
    parent,
    get shown() {
      return priceFieldText(state, parent.applied);
    },
    focus() {
      state = priceFieldFocus(parent.applied);
    },
    type(raw: string) {
      const result = priceFieldChange(state, parent.applied, raw);
      state = result.state;
      apply(result.emit);
    },
    blur() {
      const result = priceFieldBlur(state, parent.applied);
      state = result.state;
      apply(result.emit);
    },
    /** A re-render of the parent (another line changed, the cart re-computed...): nothing is given to the field. */
    rerender() {
      parent.renders += 1;
    },
  };
}

describe("typing a price: the field may be empty on the way, nothing brings the catalogue price back", () => {
  it("20 DH -> delete the 0 -> 2 DH -> delete the 2 -> empty -> 15 -> 15 DH", () => {
    const f = field(20);
    assert.equal(f.shown, "20");
    f.focus();
    f.type("2");
    assert.equal(f.shown, "2");
    assert.equal(f.parent.applied, 2);
    f.type("");
    assert.equal(f.shown, "", "the field stays empty - it is NOT refilled with the original 20");
    assert.equal(f.parent.applied, 0, "an empty field is 0 DH");
    f.type("1");
    f.type("15");
    assert.equal(f.shown, "15");
    assert.equal(f.parent.applied, 15);
    f.blur();
    assert.equal(f.shown, "15");
    assert.equal(f.parent.applied, 15);
  });

  it("an explicit 0 is a price of 0 DH, never the original price", () => {
    const f = field(20);
    f.focus();
    f.type("0");
    assert.equal(f.shown, "0");
    assert.equal(f.parent.applied, 0);
    f.blur();
    assert.equal(f.shown, "0");
    assert.equal(f.parent.applied, 0);
  });

  it("an empty field left as it is when typing ends: the applied price is 0 DH and the field shows 0", () => {
    const f = field(20);
    f.focus();
    f.type("");
    assert.equal(f.shown, "");
    f.blur();
    assert.equal(f.shown, "0");
    assert.equal(f.parent.applied, 0);
    assert.equal(f.parent.calls.at(-1), 0);
  });

  it("the typed text survives re-renders of the parent (a quantity change, another line)", () => {
    const f = field(20);
    f.focus();
    f.type("");
    f.rerender();
    f.rerender();
    assert.equal(f.shown, "", "still empty after re-renders");
    f.type("1");
    f.type("1,");
    f.rerender();
    assert.equal(f.shown, "1,", "a trailing separator is kept while typing");
    f.type("1,5");
    f.rerender();
    assert.equal(f.parent.applied, 1.5);
  });

  it("clicking in and out of the field without typing changes nothing (no manual price is created)", () => {
    const f = field(20);
    f.focus();
    f.blur();
    assert.deepEqual(f.parent.calls, []);
    assert.equal(f.parent.applied, 20);
    assert.equal(f.shown, "20");
  });

  it("not focused, the field shows the price applied from elsewhere", () => {
    const f = field(20);
    f.parent.applied = 12.5;
    assert.equal(f.shown, "12,5");
  });
});

describe("decimals and commas", () => {
  it("comma and dot are both accepted, at most 2 decimals", () => {
    const f = field(20);
    f.focus();
    f.type("15,5");
    assert.equal(f.parent.applied, 15.5);
    f.type("15.55");
    assert.equal(f.parent.applied, 15.55);
    f.type("15.555");
    assert.equal(f.shown, "15.55", "a third decimal is refused (the previous text is kept)");
    assert.equal(f.parent.applied, 15.55);
    f.blur();
    assert.equal(f.shown, "15,55");
  });

  it("a separator alone is 0, a leading separator is read (',5' = 0.5)", () => {
    assert.equal(parsePriceText("."), 0);
    assert.equal(parsePriceText(","), 0);
    assert.equal(parsePriceText(",5"), 0.5);
    assert.equal(parsePriceText("15,"), 15);
  });

  it("anything that is not a price being typed is refused: letters, signs, exponents, two separators", () => {
    for (const bad of ["abc", "-5", "+5", "1e3", "1,2,3", "1.2.3", "12a", "Infinity", "NaN"]) {
      assert.equal(parsePriceText(bad), null, bad);
      assert.equal(acceptPriceText("12", bad), "12", `${bad} keeps the previous text`);
    }
  });

  it("spaces (a paste like ' 1 5 ') are removed", () => {
    assert.equal(acceptPriceText("", " 1 5 "), "15");
  });

  it("0, '' , null and undefined are not confused", () => {
    assert.equal(parsePriceText(""), 0);
    assert.equal(parsePriceText("0"), 0);
    assert.equal(formatPriceText(0), "0");
    // "unknown" is never turned into a price
    assert.equal(formatPriceText(Number.NaN), "0");
    assert.equal(formatPriceText(-3), "0");
    assert.equal(settlePriceText(""), "0");
    assert.equal(settlePriceText("0"), "0");
    assert.equal(settlePriceText("15,"), "15");
  });

  it("formats the applied price without trailing zeros", () => {
    assert.equal(formatPriceText(20), "20");
    assert.equal(formatPriceText(20.5), "20,5");
    assert.equal(formatPriceText(1250.5), "1250,5");
    assert.equal(formatPriceText(0.07), "0,07");
  });
});
