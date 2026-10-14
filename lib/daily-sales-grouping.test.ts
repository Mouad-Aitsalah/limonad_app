import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appliedUnitPriceCents,
  canSeeDailyMargin,
  classifyLineCost,
  groupDailySales,
  summarizeMargin,
  type DailySaleLineInput,
} from "@/lib/daily-sales-grouping";

/** Pure rules of the « Regroupement des ventes » and of the « Marge totale (HT) » (no database). */

const RELIABLE_SINCE = new Date("2026-09-05T01:00:00.000Z");
const TODAY = new Date("2026-10-14T10:00:00.000Z");

function line(over: Partial<DailySaleLineInput> & Pick<DailySaleLineInput, "quantity" | "totalTTC">): DailySaleLineInput {
  return {
    productId: "p-sidi",
    productName: "Sidi Ali 2 L",
    productReference: "SA2",
    totalHT: Math.round((over.totalTTC / 1.2) * 100) / 100,
    unitCostHT: 12.5,
    createdAt: TODAY,
    ...over,
  };
}

const opts = (over: Partial<Parameters<typeof groupDailySales>[1]> = {}) => ({
  includeMargin: true,
  reliableSince: RELIABLE_SINCE,
  roundingTotal: 0,
  revenueTotal: 0,
  ...over,
});

test("the business example: 4 Sidi Ali 2 L, 3 at 20 DH and 1 at 19 DH -> two price rows, total 4 units / 79 DH", () => {
  const lines = [
    line({ quantity: 2, totalTTC: 40 }), // two invoices at the same price are added together...
    line({ quantity: 1, totalTTC: 20 }),
    line({ quantity: 1, totalTTC: 19 }), // ...a different price never is
  ];
  const result = groupDailySales(lines, opts({ revenueTotal: 79 }));
  assert.equal(result.products.length, 1);
  const [product] = result.products;
  assert.deepEqual(product.priceGroups.map(({ unitPriceTTC, quantity, amountTTC }) => ({ unitPriceTTC, quantity, amountTTC })), [
    { unitPriceTTC: 20, quantity: 3, amountTTC: 60 },
    { unitPriceTTC: 19, quantity: 1, amountTTC: 19 },
  ]);
  assert.equal(product.totalQuantity, 4);
  assert.equal(product.totalTTC, 79);
  assert.equal(result.totals.totalQuantity, 4);
  assert.equal(result.totals.linesTotalTTC, 79);
  assert.equal(result.totals.reconciled, true);
});

test("the price is the one REALLY applied on the line (totalTTC / quantity, discount included), to the cent - never merged with another", () => {
  assert.equal(appliedUnitPriceCents({ quantity: 3, totalTTC: 57 }), 1900);
  assert.equal(appliedUnitPriceCents({ quantity: 4, totalTTC: 79.96 }), 1999);
  const result = groupDailySales(
    [line({ quantity: 1, totalTTC: 20 }), line({ quantity: 4, totalTTC: 79.96 }), line({ quantity: 2, totalTTC: 39.98 })],
    opts({ revenueTotal: 139.94 }),
  );
  assert.deepEqual(
    result.products[0].priceGroups.map((group) => [group.unitPriceTTC, group.quantity, group.amountTTC]),
    [
      [20, 1, 20],
      [19.99, 6, 119.94],
    ],
    "19.99 and 20.00 stay two rows",
  );
});

test("an old percentage-discount line whose unit price is not a whole cent is keyed to the nearest cent; its amount stays the real stored total", () => {
  const result = groupDailySales([line({ quantity: 3, totalTTC: 59.99 })], opts({ revenueTotal: 59.99 }));
  assert.deepEqual(result.products[0].priceGroups.map(({ unitPriceTTC, quantity, amountTTC }) => ({ unitPriceTTC, quantity, amountTTC })), [{ unitPriceTTC: 20, quantity: 3, amountTTC: 59.99 }]);
  assert.equal(result.products[0].totalTTC, 59.99, "no amount is recomputed from the rounded price");
});

test("several products: separate blocks, sorted by name; quantities and amounts add up without double counting", () => {
  const lines = [
    line({ quantity: 2, totalTTC: 40 }),
    line({ productId: "p-oulmes", productName: "Oulmès 1 L", productReference: "OU1", quantity: 6, totalTTC: 36 }),
    line({ productId: "p-ain", productName: "Aïn Saïss 1,5 L", productReference: "AS15", quantity: 1, totalTTC: 5.5 }),
  ];
  const result = groupDailySales(lines, opts({ revenueTotal: 81.5 }));
  assert.deepEqual(result.products.map((product) => product.name), ["Aïn Saïss 1,5 L", "Oulmès 1 L", "Sidi Ali 2 L"]);
  assert.equal(result.totals.productCount, 3);
  assert.equal(result.totals.totalQuantity, 9);
  assert.equal(result.totals.linesTotalTTC, 81.5);
});

test("reconciliation with the CA total: products + commercial rounding = Σ Sale.totalTTC; any gap is reported, never hidden", () => {
  const lines = [line({ quantity: 1, totalTTC: 19.8 }), line({ quantity: 1, totalTTC: 9.9 })];
  const ok = groupDailySales(lines, opts({ roundingTotal: 0.3, revenueTotal: 30 }));
  assert.equal(ok.totals.linesTotalTTC, 29.7);
  assert.equal(ok.totals.roundingTotal, 0.3);
  assert.equal(ok.totals.reconciliationGap, 0);
  assert.equal(ok.totals.reconciled, true);
  const gap = groupDailySales(lines, opts({ roundingTotal: 0.3, revenueTotal: 31 }));
  assert.equal(gap.totals.reconciliationGap, 1);
  assert.equal(gap.totals.reconciled, false);
});

test("margin HT = Σ(totalHT − qty × unitCostHT) and taux de marque = margin HT / CA HT × 100, per product and in total", () => {
  // 3 units at 20 TTC (HT 50.00 for the 3) and 1 at 19 TTC (HT 15.83), cost 12.50 HT each
  const lines = [line({ quantity: 3, totalTTC: 60, totalHT: 50 }), line({ quantity: 1, totalTTC: 19, totalHT: 15.83 })];
  const result = groupDailySales(lines, opts({ revenueTotal: 79 }));
  const margin = result.products[0].margin!;
  assert.equal(margin.revenueHT, 65.83);
  assert.equal(margin.marginHT, 15.83); // 65.83 − 4 × 12.50
  assert.equal(margin.markupRate, 24.05); // 15.83 / 65.83 × 100
  assert.equal(margin.partial, false);
  assert.deepEqual(result.margin, margin, "one product: the total margin is that product's");
});

test("the margin of each applied price uses the same rule on the lines sold at that price; the three levels add up", () => {
  const lines = [line({ quantity: 3, totalTTC: 60, totalHT: 50 }), line({ quantity: 1, totalTTC: 19, totalHT: 15.83 })];
  const [product] = groupDailySales(lines, opts({ revenueTotal: 79 })).products;
  const [at20, at19] = product.priceGroups;
  assert.deepEqual([at20.margin!.marginHT, at20.margin!.markupRate], [12.5, 25]); // 50 − 3 × 12.50
  assert.deepEqual([at19.margin!.marginHT, at19.margin!.markupRate], [3.33, 21.04]); // 15.83 − 12.50
  assert.equal(Math.round((at20.margin!.marginHT + at19.margin!.marginHT) * 100) / 100, product.margin!.marginHT);
  const hidden = groupDailySales(lines, opts({ includeMargin: false, revenueTotal: 79 })).products[0];
  assert.equal(hidden.priceGroups.some((group) => "margin" in group), false, "no margin per price without the right");
});

test("a zero or unknown cost never produces an artificial margin: the line is left out and reported (the schema cannot tell a real 0 from an unknown cost)", () => {
  const lines = [
    line({ quantity: 2, totalTTC: 24, totalHT: 20, unitCostHT: 8 }),
    line({ quantity: 1, totalTTC: 12, totalHT: 10, unitCostHT: 0 }),
    line({ quantity: 1, totalTTC: 12, totalHT: 10, unitCostHT: null }),
  ];
  const margin = summarizeMargin(lines, RELIABLE_SINCE);
  assert.equal(margin.marginHT, 4); // only the first line: 20 − 2 × 8
  assert.equal(margin.revenueHT, 20);
  assert.equal(margin.markupRate, 20);
  assert.equal(margin.partial, true);
  assert.equal(margin.missingCostLines, 2);
  assert.equal(margin.totalRevenueHT, 40);
  assert.equal(margin.excludedRevenueHT, 20);
});

test("a line older than the cost snapshot (back-filled, approximate cost) is left out and reported as approximate", () => {
  const old = line({ quantity: 1, totalTTC: 12, totalHT: 10, unitCostHT: 5, createdAt: new Date("2026-08-20T10:00:00.000Z") });
  assert.equal(classifyLineCost(old, RELIABLE_SINCE), "approximate");
  assert.equal(classifyLineCost(line({ quantity: 1, totalTTC: 12 }), RELIABLE_SINCE), "reliable");
  assert.equal(classifyLineCost(line({ quantity: 1, totalTTC: 12, unitCostHT: 0 }), RELIABLE_SINCE), "missing");
  const margin = summarizeMargin([old], RELIABLE_SINCE);
  assert.equal(margin.approximateCostLines, 1);
  assert.equal(margin.partial, true);
  assert.equal(margin.markupRate, null, "nothing reliable to divide by: « — »");
  assert.equal(margin.marginHT, 0);
});

test("no CA HT -> no rate (null, shown « — »), no division by zero", () => {
  assert.equal(summarizeMargin([], RELIABLE_SINCE).markupRate, null);
  const free = summarizeMargin([line({ quantity: 1, totalTTC: 0, totalHT: 0, unitCostHT: 3 })], RELIABLE_SINCE);
  assert.equal(free.markupRate, null);
  assert.equal(free.marginHT, -3, "a product given away at a real cost is a real loss");
});

test("without the margin right nothing about margins exists in the result - not even an empty field", () => {
  const result = groupDailySales([line({ quantity: 1, totalTTC: 20, unitCostHT: undefined })], opts({ includeMargin: false, revenueTotal: 20 }));
  assert.equal("margin" in result, false);
  assert.equal("margin" in result.products[0], false);
  assert.equal(JSON.stringify(result).includes("margin"), false);
  assert.equal(JSON.stringify(result).includes("unitCost"), false);
});

test("margin rights: the admin only", () => {
  assert.equal(canSeeDailyMargin("admin"), true);
  for (const role of ["depot_manager", "cashier", "driver", "super_admin", "", null, undefined]) {
    assert.equal(canSeeDailyMargin(role), false, String(role));
  }
});
