import assert from "node:assert/strict";
import { test } from "node:test";

import {
  creditNoteExceedsSaleTotal,
  creditNoteRoundingShare,
  creditNoteRoundingShareForSales,
  roundingShareAlreadyReturned,
  type SaleLineForReturn,
  type SaleReturnOrigin,
} from "@/lib/credit-note-rounding";
import { roundMoney } from "@/lib/money";

// A sale whose lines are worth 339.49 and whose final total was rounded to 339.50 (+0.01),
// another one worth 339.74 -> 339.50 (-0.24), a bigger one 339.75 -> 340.00 (+0.25).
const line = (
  totalTTC: number,
  quantity: number,
  alreadyReturnedQuantity = 0,
  returningQuantity = 0,
): SaleLineForReturn => ({ totalTTC, quantity, alreadyReturnedQuantity, returningQuantity });

const origin = (saleRoundingAmount: number, lines: SaleLineForReturn[]): SaleReturnOrigin => ({
  saleRoundingAmount,
  lines,
});

/** Applies a sequence of returns (each: quantity per line) and returns the shares given back. */
function replay(saleRoundingAmount: number, sold: Array<[totalTTC: number, quantity: number]>, returns: number[][]) {
  const returned = sold.map(() => 0);
  const shares: number[] = [];
  for (const quantities of returns) {
    const share = creditNoteRoundingShare(
      origin(
        saleRoundingAmount,
        sold.map(([totalTTC, quantity], index) => line(totalTTC, quantity, returned[index], quantities[index] ?? 0)),
      ),
    );
    shares.push(share);
    quantities.forEach((quantity, index) => {
      returned[index] += quantity;
    });
  }
  return shares;
}

const sum = (values: number[]) => roundMoney(values.reduce((total, value) => total + value, 0));

// ---- total return ----------------------------------------------------------------------------------

test("a total return in ONE credit note gives back exactly the sale's rounding (+0.01 / -0.24 / +0.25)", () => {
  for (const rounding of [0.01, -0.24, 0.25, -0.01]) {
    const [share] = replay(rounding, [[339.49, 1]], [[1]]);
    assert.equal(share, rounding);
  }
});

test("a total return in TWO or THREE notes: the shares add up to the rounding exactly, never more", () => {
  const sold: Array<[number, number]> = [
    [100.1, 10],
    [150.3, 3],
    [89.09, 7],
  ];
  const rounding = 0.25;
  for (const returns of [
    [[10, 3, 7]],
    [[4, 1, 2], [6, 2, 5]],
    [[3, 1, 1], [3, 1, 3], [4, 1, 3]],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1], [9, 2, 6]],
  ]) {
    const shares = replay(rounding, sold, returns);
    assert.equal(sum(shares), rounding, JSON.stringify(returns));
    for (const share of shares) assert.ok(share >= 0 && share <= rounding);
  }
});

test("a negative rounding is given back with the same rule (sum = the negative rounding)", () => {
  const sold: Array<[number, number]> = [[339.74, 6]];
  const shares = replay(-0.24, sold, [[1], [2], [3]]);
  assert.equal(sum(shares), -0.24);
  for (const share of shares) assert.ok(share <= 0 && share >= -0.24);
});

test("the return value is measured on quantities: 1 + 1 + 1 pieces equal 3 pieces at once", () => {
  const sold: Array<[number, number]> = [[0.5, 3]];
  const byPieces = sum(replay(0.25, sold, [[1], [1], [1]]));
  const atOnce = sum(replay(0.25, sold, [[3]]));
  assert.equal(byPieces, atOnce);
  assert.equal(byPieces, 0.25);
});

// ---- partial return ---------------------------------------------------------------------------------

test("a partial return gives back a proportional part: half of the goods -> half of the rounding", () => {
  const [share] = replay(0.25, [[200, 10]], [[5]]);
  assert.equal(share, 0.13, "0.125 rounds half up to 0.13");
  const [quarter] = replay(0.24, [[200, 10]], [[5]]);
  assert.equal(quarter, 0.12);
});

test("a partial return alone never exceeds the rounding and a later return completes it", () => {
  const sold: Array<[number, number]> = [[339.49, 4]];
  const shares = replay(0.25, sold, [[1], [1]]);
  assert.ok(shares[0] > 0 && shares[0] < 0.25);
  assert.equal(creditNoteRoundingShare(origin(0.25, [line(339.49, 4, 2, 2)])), roundMoney(0.25 - sum(shares)));
});

test("cumulative state: roundingShareAlreadyReturned = what the validated notes got", () => {
  const sold: Array<[number, number]> = [[339.49, 4]];
  const shares = replay(0.25, sold, [[1], [2]]);
  assert.equal(roundingShareAlreadyReturned(origin(0.25, [line(339.49, 4, 3, 0)])), sum(shares));
  assert.equal(roundingShareAlreadyReturned(origin(0.25, [line(339.49, 4, 0, 0)])), 0);
  assert.equal(roundingShareAlreadyReturned(origin(0, [line(339.49, 4, 3, 0)])), 0);
});

// ---- no rounding / free return ------------------------------------------------------------------------

test("a sale without rounding (every sale created before the feature) gives back nothing", () => {
  assert.equal(creditNoteRoundingShare(origin(0, [line(339.49, 2, 0, 2)])), 0);
  assert.equal(creditNoteRoundingShareForSales([]), 0, "free return: no sale at all");
  assert.equal(Object.is(creditNoteRoundingShare(origin(0, [line(1, 1, 0, 1)])), 0), true);
});

test("returning nothing gives back nothing", () => {
  assert.equal(creditNoteRoundingShare(origin(0.25, [line(339.49, 2, 0, 0)])), 0);
});

test("a quantity above what was sold never produces more than the rounding", () => {
  assert.equal(creditNoteRoundingShare(origin(0.25, [line(339.49, 2, 0, 5)])), 0.25);
});

// ---- several sales in one note -------------------------------------------------------------------------

test("a credit note spanning two sales gives back the sum of each sale's own share", () => {
  const first = origin(0.25, [line(339.75, 3, 0, 3)]);
  const second = origin(-0.24, [line(339.74, 4, 0, 2)]);
  const shareFirst = creditNoteRoundingShare(first);
  const shareSecond = creditNoteRoundingShare(second);
  assert.equal(shareFirst, 0.25);
  assert.equal(shareSecond, -0.12);
  assert.equal(creditNoteRoundingShareForSales([first, second]), roundMoney(shareFirst + shareSecond));
});

// ---- the refund ceiling (409) ---------------------------------------------------------------------------

test("a total return never exceeds the sale's final total: lines + rounding = totalTTC", () => {
  // sale lines 339.49, rounding +0.01 -> final 339.50
  assert.equal(
    creditNoteExceedsSaleTotal({
      saleTotalTTC: 339.5,
      alreadyCreditedLinesTTC: 0,
      alreadyCreditedRounding: 0,
      noteLinesTTC: 339.49,
      noteRoundingShare: 0.01,
      lineCount: 1,
    }),
    false,
  );
  // the refund of a sale rounded DOWN (339.74 -> 339.50) is 339.50, not 339.74
  assert.equal(
    creditNoteExceedsSaleTotal({
      saleTotalTTC: 339.5,
      alreadyCreditedLinesTTC: 0,
      alreadyCreditedRounding: 0,
      noteLinesTTC: 339.74,
      noteRoundingShare: -0.24,
      lineCount: 1,
    }),
    false,
  );
});

test("a refund above the sale's final total is refused", () => {
  // the same sale, lines refunded WITHOUT giving back the negative rounding: 339.74 > 339.50
  assert.equal(
    creditNoteExceedsSaleTotal({
      saleTotalTTC: 339.5,
      alreadyCreditedLinesTTC: 0,
      alreadyCreditedRounding: 0,
      noteLinesTTC: 339.74,
      noteRoundingShare: 0,
      lineCount: 1,
    }),
    true,
  );
  // two notes: the second one pushes the cumulative amount over the total
  assert.equal(
    creditNoteExceedsSaleTotal({
      saleTotalTTC: 100,
      alreadyCreditedLinesTTC: 80,
      alreadyCreditedRounding: 0,
      noteLinesTTC: 21,
      noteRoundingShare: 0,
      lineCount: 2,
    }),
    true,
  );
});

test("one cent per sale line of tolerance: returning 1 + 1 + 1 pieces of a 0.50 line (0.17 x 3 = 0.51) is not blocked", () => {
  assert.equal(
    creditNoteExceedsSaleTotal({
      saleTotalTTC: 0.5,
      alreadyCreditedLinesTTC: 0.34,
      alreadyCreditedRounding: 0,
      noteLinesTTC: 0.17,
      noteRoundingShare: 0,
      lineCount: 1,
    }),
    false,
  );
  assert.equal(
    creditNoteExceedsSaleTotal({
      saleTotalTTC: 0.5,
      alreadyCreditedLinesTTC: 0.34,
      alreadyCreditedRounding: 0,
      noteLinesTTC: 0.19,
      noteRoundingShare: 0,
      lineCount: 1,
    }),
    true,
    "beyond the tolerance it is refused",
  );
});
