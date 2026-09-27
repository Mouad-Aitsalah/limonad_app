import assert from "node:assert/strict";
import { test } from "node:test";

import type { DailySeries, ProductEvaluation, SalesPrediction } from "./forecast-engine";
import { summarizeEvaluations } from "./forecast-engine";
import { buildSnapshotRows } from "./purchase-forecast-snapshot";
import type { SalesForecastResult } from "./sales-forecast";

const dummyEvaluation = (productId: string, seriesDays: number): ProductEvaluation => ({
  productId,
  productName: "x",
  seriesDays,
  testDays: 0,
  trainDays: 0,
  trainRows: 0,
  metrics: {},
  best: "moving_average",
});

function prediction(overrides: Partial<SalesPrediction> = {}): SalesPrediction {
  return {
    productId: "p1",
    productName: "Coca 2L",
    predictionDate: "2026-09-14",
    horizonDay: 1,
    predictedQuantity: 5,
    predictedQuantityRaw: 5,
    model: "moving_average",
    mae: 0.4,
    ...overrides,
  };
}

function forecastResult(overrides: Partial<SalesForecastResult> = {}): SalesForecastResult {
  return {
    asOf: "2026-09-13",
    horizon: 7,
    predictions: [],
    evaluations: [],
    series: [],
    summary: summarizeEvaluations([]),
    ...overrides,
  };
}

test("one row per product; forecast1/3/7Days are the exact sums sumForecastDays would give", () => {
  const predictions = [1, 2, 3, 4, 5, 6, 7].map((day, i) =>
    prediction({ horizonDay: day, predictedQuantityRaw: 0.4 + i, predictedQuantity: Math.round(0.4 + i) }),
  );
  const series: DailySeries = { productId: "p1", productName: "Coca 2L", dates: ["2026-09-01"], values: [3] };
  const forecast = forecastResult({ predictions, series: [series], evaluations: [dummyEvaluation("p1", 1)] });
  const rows = buildSnapshotRows("org1", "2026-09-14", forecast);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.organizationId, "org1");
  assert.equal(row.businessDay, "2026-09-14");
  assert.equal(row.productId, "p1");
  assert.equal(row.productName, "Coca 2L");
  assert.equal(row.forecast1Day, Math.round(0.4));
  assert.equal(row.forecast3Days, Math.round(0.4 + 1.4 + 2.4));
  const raw7 = [0.4, 1.4, 2.4, 3.4, 4.4, 5.4, 6.4].reduce((a, b) => a + b, 0);
  assert.equal(row.forecast7Days, Math.round(raw7));
  assert.ok(Math.abs(row.predictedQuantityRaw - raw7) < 1e-9, "predictedQuantityRaw is the UNROUNDED 7-day sum");
  assert.equal(row.model, "moving_average");
  assert.equal(row.mae, 0.4);
  assert.equal(row.historyDays, 1);
  assert.equal(row.soldDays, 1);
});

test("several products in one organisation: one row each, no cross-talk", () => {
  const forecast = forecastResult({
    predictions: [prediction({ productId: "a", productName: "A" }), prediction({ productId: "b", productName: "B", predictedQuantityRaw: 9, predictedQuantity: 9 })],
    series: [
      { productId: "a", productName: "A", dates: ["2026-09-01"], values: [1] },
      { productId: "b", productName: "B", dates: ["2026-09-01", "2026-09-02"], values: [0, 9] },
    ],
  });
  const rows = buildSnapshotRows("org1", "2026-09-14", forecast);
  assert.equal(rows.length, 2);
  const byId = new Map(rows.map((r) => [r.productId, r]));
  assert.equal(byId.get("a")!.forecast1Day, 5);
  assert.equal(byId.get("b")!.forecast1Day, 9);
  assert.equal(byId.get("b")!.historyDays, 2);
  assert.equal(byId.get("b")!.soldDays, 1);
});

test("a never-sold product (no prediction at all) produces no row - the snapshot only covers what could be forecast", () => {
  const forecast = forecastResult({ predictions: [], series: [] });
  assert.deepEqual(buildSnapshotRows("org1", "2026-09-14", forecast), []);
});

test("reliability label matches the thresholds used elsewhere (none/very_limited/limited/sufficient)", () => {
  const of = (historyDays: number, soldDaysCount: number) => {
    const values = [...new Array(historyDays - soldDaysCount).fill(0), ...new Array(soldDaysCount).fill(1)];
    const forecast = forecastResult({
      predictions: [prediction({ productId: "p", productName: "P" })],
      series: [{ productId: "p", productName: "P", dates: values.map((_, i) => `d${i}`), values }],
    });
    return buildSnapshotRows("org1", "2026-09-14", forecast)[0].reliability;
  };
  assert.equal(of(0, 0), "none");
  assert.equal(of(20, 20), "very_limited");
  assert.equal(of(100, 4), "very_limited");
  assert.equal(of(59, 40), "limited");
  assert.equal(of(60, 15), "sufficient");
});

test("the snapshot never contains currentStock, safetyStock, targetStock, recommendedPurchase or a stock alert", () => {
  const forecast = forecastResult({
    predictions: [prediction()],
    series: [{ productId: "p1", productName: "Coca 2L", dates: ["2026-09-01"], values: [5] }],
  });
  const row = buildSnapshotRows("org1", "2026-09-14", forecast)[0];
  for (const forbidden of ["currentStock", "safetyStock", "targetStock", "recommendedPurchaseQuantity", "stockAlert", "stockRegularizationRequired"]) {
    assert.equal(forbidden in row, false, forbidden);
  }
});
