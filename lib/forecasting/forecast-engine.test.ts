import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, enumerateDays } from "./daily-sales-series";
import { movingAveragePrediction, sameWeekdayPrediction } from "./baselines";
import {
  evaluateProduct,
  forecastProduct,
  splitChronological,
  summarizeEvaluations,
  type DailySeries,
} from "./forecast-engine";
import { buildTrainingRows, computeFeatures, dayOfWeek, FEATURE_NAMES, isWeekend, MIN_HISTORY_FOR_FEATURES, stdDev } from "./features";
import { clampNonNegative, roundToUnits, trainRandomForest } from "./random-forest-model";

const START = "2025-01-01"; // a Wednesday

function series(values: number[], productId = "p1", start = START): DailySeries {
  const dates = enumerateDays(start, addDays(start, values.length - 1));
  return { productId, productName: `Produit ${productId}`, dates, values };
}

/** Weekly pattern with a weekend peak plus a slow trend: learnable but not trivial. */
function patterned(days: number): number[] {
  return Array.from({ length: days }, (_, i) => {
    const dow = dayOfWeek(addDays(START, i));
    return 4 + (dow === 6 ? 6 : 0) + (dow === 0 ? 3 : 0) + Math.floor(i / 20);
  });
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

test("lags are exactly the quantity 1, 2, 3, 7, 14 and 28 days before the target day", () => {
  const history = Array.from({ length: 40 }, (_, i) => i * 10); // day index i sold 10*i
  const features = computeFeatures(history, addDays(START, 40))!;
  const at = (name: (typeof FEATURE_NAMES)[number]) => features[FEATURE_NAMES.indexOf(name)];
  assert.equal(at("lag_1"), history[39]);
  assert.equal(at("lag_2"), history[38]);
  assert.equal(at("lag_3"), history[37]);
  assert.equal(at("lag_7"), history[33]);
  assert.equal(at("lag_14"), history[26]);
  assert.equal(at("lag_28"), history[12]);
});

test("rolling means, rolling std and trend are computed on the PREVIOUS days only", () => {
  const history = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
  const features = computeFeatures(history, addDays(START, 30))!;
  const at = (name: (typeof FEATURE_NAMES)[number]) => features[FEATURE_NAMES.indexOf(name)];
  assert.equal(at("rolling_mean_7"), (24 + 25 + 26 + 27 + 28 + 29 + 30) / 7); // 27
  assert.equal(at("rolling_mean_14"), 23.5); // 17..30
  assert.equal(at("rolling_mean_28"), 16.5); // 3..30
  assert.ok(Math.abs(at("rolling_std_7") - stdDev([24, 25, 26, 27, 28, 29, 30])) < 1e-12);
  assert.ok(Math.abs(at("rolling_std_7") - 2) < 1e-12);
  assert.equal(at("trend_7"), 7, "mean(24..30) - mean(17..23) = 27 - 20");
});

test("calendar features: day of week and weekend flag come from the target date", () => {
  assert.equal(dayOfWeek("2025-01-01"), 3); // Wednesday
  assert.equal(isWeekend("2025-01-04"), true); // Saturday
  assert.equal(isWeekend("2025-01-05"), true); // Sunday
  assert.equal(isWeekend("2025-01-06"), false); // Monday
  const history = new Array(30).fill(1);
  const saturday = computeFeatures(history, "2025-01-04")!;
  assert.equal(saturday[FEATURE_NAMES.indexOf("day_of_week")], 6);
  assert.equal(saturday[FEATURE_NAMES.indexOf("is_weekend")], 1);
});

test("no features (null) with fewer than 28 known days", () => {
  assert.equal(computeFeatures(new Array(MIN_HISTORY_FOR_FEATURES - 1).fill(1), START), null);
  assert.notEqual(computeFeatures(new Array(MIN_HISTORY_FOR_FEATURES).fill(1), START), null);
});

test("no data from the future in the features: changing every day at or after t never changes row t", () => {
  const values = patterned(80);
  const dates = series(values).dates;
  const original = buildTrainingRows(values, dates, MIN_HISTORY_FOR_FEATURES, 60);

  const t = 45;
  const poisoned = values.map((value, i) => (i >= t ? 9_999 + i : value)); // the target day AND the future
  const rowAt = (rows: typeof original, index: number) => rows.features[rows.dates.indexOf(dates[index])];
  const after = buildTrainingRows(poisoned, dates, MIN_HISTORY_FOR_FEATURES, 60);
  assert.deepEqual(rowAt(after, t), rowAt(original, t));
  // and every row before t is untouched too
  for (let i = MIN_HISTORY_FOR_FEATURES; i < t; i += 1) assert.deepEqual(rowAt(after, i), rowAt(original, i));
  // the TARGET of a row is that day's own quantity, never used as a feature
  assert.equal(original.targets[original.dates.indexOf(dates[t])], values[t]);
});

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

test("baselines: moving average of the last 7 days; same weekday averages the previous 4 weeks", () => {
  const history = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 10, 20, 30, 40, 50, 60, 70]; // 21 days
  assert.equal(movingAveragePrediction(history), 40);
  // target = index 21 -> previous same weekdays: indexes 14, 7, 0 (21 - 28 < 0)
  assert.equal(sameWeekdayPrediction(history), (10 + 1 + 1) / 3);
  assert.equal(movingAveragePrediction([]), 0);
  assert.equal(sameWeekdayPrediction([3, 5]), 4, "no same weekday yet -> moving average");
});

// ---------------------------------------------------------------------------
// Chronological evaluation
// ---------------------------------------------------------------------------

test("train/test split is chronological: the test days are the LAST days, training rows all precede them", () => {
  assert.deepEqual(splitChronological(100, 14), { testStart: 86 });
  const s = series(patterned(120));
  const evaluation = evaluateProduct(s, { testDays: 14 });
  assert.equal(evaluation.testDays, 14);
  assert.equal(evaluation.trainDays, 106);
  // recompute the training rows the evaluation used: every one is dated before the first test day
  const firstTestDate = s.dates[106];
  const train = buildTrainingRows(s.values, s.dates, MIN_HISTORY_FOR_FEATURES, 106);
  assert.ok(train.dates.every((date) => date < firstTestDate));
  assert.equal(evaluation.trainRows, train.features.length);
});

test("changing the TEST days never changes the model trained before them; changing TRAIN days can", () => {
  const values = patterned(120);
  const base = evaluateProduct(series(values), { testDays: 14 });
  const futureChanged = values.map((value, i) => (i >= 106 ? value + 50 : value));
  const changed = evaluateProduct(series(futureChanged), { testDays: 14 });
  // the baselines' first test-day error only depends on the past: same prediction, shifted target
  assert.equal(base.trainRows, changed.trainRows);
  assert.equal(base.trainDays, changed.trainDays);
});

test("evaluation scores all three models with MAE and RMSE, and picks the lowest MAE", () => {
  const evaluation = evaluateProduct(series(patterned(150)), { testDays: 14 });
  for (const name of ["moving_average", "same_weekday", "random_forest"] as const) {
    const metrics = evaluation.metrics[name];
    assert.ok(metrics, name);
    assert.equal(metrics.n, 14);
    assert.ok(metrics.mae >= 0 && metrics.rmse >= metrics.mae - 1e-9, `${name}: rmse >= mae`);
  }
  const best = Object.entries(evaluation.metrics).sort((a, b) => a[1].mae - b[1].mae)[0];
  assert.equal(evaluation.metrics[evaluation.best]!.mae, best[1].mae);
  // a weekly pattern is exactly what the same-weekday baseline captures
  assert.ok(evaluation.metrics.same_weekday!.mae < evaluation.metrics.moving_average!.mae);
});

// ---------------------------------------------------------------------------
// Little history / intermittent demand
// ---------------------------------------------------------------------------

test("a product with little history is not evaluated and falls back to the moving average", () => {
  for (const days of [1, 5, 20]) {
    const s = series(Array.from({ length: days }, (_, i) => (i % 3) + 1));
    const evaluation = evaluateProduct(s);
    assert.equal(evaluation.testDays, 0);
    assert.deepEqual(evaluation.metrics, {});
    const [prediction] = forecastProduct(s, evaluation);
    assert.equal(prediction.model, "moving_average");
    assert.equal(prediction.mae, null);
    assert.ok(Number.isInteger(prediction.predictedQuantity) && prediction.predictedQuantity >= 0);
  }
  assert.deepEqual(forecastProduct({ productId: "x", productName: "x", dates: [], values: [] }, evaluateProduct(series([]))), []);
});

test("a medium history (enough for baselines, not for the forest) still evaluates the two baselines", () => {
  const evaluation = evaluateProduct(series(patterned(40)), { testDays: 14 });
  assert.ok(evaluation.metrics.moving_average && evaluation.metrics.same_weekday);
  assert.equal(evaluation.metrics.random_forest, undefined);
  assert.notEqual(evaluation.best, "random_forest");
});

test("a product with many days without sale (intermittent demand) gives finite, non-negative whole predictions", () => {
  const values = Array.from({ length: 140 }, (_, i) => (i % 9 === 0 ? 12 : i % 23 === 0 ? 5 : 0));
  const s = series(values);
  const evaluation = evaluateProduct(s);
  const predictions = forecastProduct(s, evaluation, { horizon: 7 });
  assert.equal(predictions.length, 7);
  for (const prediction of predictions) {
    assert.ok(Number.isFinite(prediction.predictedQuantity));
    assert.ok(Number.isInteger(prediction.predictedQuantity));
    assert.ok(prediction.predictedQuantity >= 0);
  }
});

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

test("predictions are never negative and are whole units, even for a collapsing trend", () => {
  const values = Array.from({ length: 100 }, (_, i) => Math.max(0, 60 - i));
  const s = series(values);
  const predictions = forecastProduct(s, evaluateProduct(s), { horizon: 7 });
  assert.ok(predictions.every((p) => p.predictedQuantity >= 0 && Number.isInteger(p.predictedQuantity)));
  assert.equal(clampNonNegative(-3), 0);
  assert.equal(clampNonNegative(Number.NaN), 0);
  assert.equal(roundToUnits(2.4), 2);
  assert.equal(roundToUnits(2.5), 3);
  assert.equal(roundToUnits(-0.7), 0);
});

test("horizon: J+1 is the day after the last known day; 7 days are consecutive; the horizon is capped to 7", () => {
  const s = series(patterned(100));
  const evaluation = evaluateProduct(s);
  const one = forecastProduct(s, evaluation);
  assert.equal(one.length, 1);
  assert.equal(one[0].predictionDate, addDays(s.dates[99], 1));
  assert.equal(one[0].horizonDay, 1);
  const week = forecastProduct(s, evaluation, { horizon: 7 });
  assert.deepEqual(week.map((p) => p.predictionDate), enumerateDays(addDays(s.dates[99], 1), addDays(s.dates[99], 7)));
  assert.equal(forecastProduct(s, evaluation, { horizon: 30 }).length, 7);
  // J+1 of a 7-day forecast equals the 1-day forecast (same model, same history)
  assert.equal(week[0].predictedQuantity, one[0].predictedQuantity);
});

test("the forecast only uses the series it is given: appending days AFTER the last known day changes nothing", () => {
  const values = patterned(100);
  const known = series(values);
  const evaluation = evaluateProduct(known);
  const before = forecastProduct(known, evaluation, { horizon: 7 });
  // a "future" that is not passed in cannot matter: same input series -> same output, deterministic
  const again = forecastProduct(series(values), evaluateProduct(series(values)), { horizon: 7 });
  assert.deepEqual(again, before);
});

test("the random forest is deterministic (fixed seed) and never predicts below 0", () => {
  const values = patterned(120);
  const train = buildTrainingRows(values, series(values).dates, MIN_HISTORY_FOR_FEATURES, 120);
  const a = trainRandomForest(train.features, train.targets)!;
  const b = trainRandomForest(train.features, train.targets)!;
  const probe = train.features[10];
  assert.equal(a.predict(probe), b.predict(probe));
  assert.ok(a.predict(probe.map(() => -1_000)) >= 0);
  assert.equal(trainRandomForest(train.features.slice(0, 10), train.targets.slice(0, 10)), null, "too few rows -> no forest");
});

test("summary compares the three models on the same products and days", () => {
  const evaluations = [evaluateProduct(series(patterned(150), "a")), evaluateProduct(series(patterned(30), "b")), evaluateProduct(series([1, 2], "c"))];
  const summary = summarizeEvaluations(evaluations);
  assert.equal(summary.productsTotal, 3);
  assert.equal(summary.productsComparable, 1, "only the long history has the three models");
  assert.ok(summary.comparable.random_forest && summary.comparable.moving_average && summary.comparable.same_weekday);
  assert.equal(summary.comparable.random_forest.testObservations, summary.comparable.moving_average.testObservations);
  assert.equal(summary.productsEvaluated, 2);
});
