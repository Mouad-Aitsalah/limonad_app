import { addDays } from "./daily-sales-series";
import { movingAveragePrediction, sameWeekdayPrediction } from "./baselines";
import { buildTrainingRows, computeFeatures, MIN_HISTORY_FOR_FEATURES } from "./features";
import { clampNonNegative, MIN_RANDOM_FOREST_TRAIN_ROWS, roundToUnits, trainRandomForest, type Regressor } from "./random-forest-model";

/**
 * Forecasting step 2 - evaluation and prediction for ONE product, on its
 * complete consecutive daily series (Produit x Jour, zeros included).
 *
 * Evaluation is chronological: the LAST `testDays` days are the test set, the
 * days before are the training set. Every prediction of a test day only uses
 * days strictly before it (baselines: the history slice; Random Forest: a
 * forest trained ONLY on rows dated before the first test day, fed with
 * features computed from the days before the predicted day). The real
 * quantities of earlier test days are legitimately known when a later test day
 * is predicted (one-step-ahead, as in daily use); nothing comes from the future.
 */

export type ModelName = "moving_average" | "same_weekday" | "random_forest";

/** Order used to break ties: the simplest model wins. */
export const MODEL_PREFERENCE: ModelName[] = ["moving_average", "same_weekday", "random_forest"];

export const DEFAULT_TEST_DAYS = 14;
/** Below this many days the product is only forecast with the moving average. */
export const MIN_DAYS_FOR_EVALUATION = 21;

export type DailySeries = {
  productId: string;
  productName: string;
  /** Consecutive business days, oldest first. */
  dates: string[];
  values: number[];
};

export type ModelMetrics = {
  mae: number;
  rmse: number;
  /** Number of test days scored. */
  n: number;
  absErrorSum: number;
  squaredErrorSum: number;
};

export type ProductEvaluation = {
  productId: string;
  productName: string;
  seriesDays: number;
  testDays: number;
  trainDays: number;
  trainRows: number;
  metrics: Partial<Record<ModelName, ModelMetrics>>;
  /** Model with the lowest test MAE; moving_average when nothing could be evaluated. */
  best: ModelName;
};

export type SalesPrediction = {
  productId: string;
  productName: string;
  predictionDate: string;
  /** 1 = the day right after the last known day. */
  horizonDay: number;
  /** Whole units, never negative. */
  predictedQuantity: number;
  /**
   * The same prediction before rounding (never negative). Summing the rounded
   * daily values would lose small demands (0.4 a day rounds to 0 every day),
   * so multi-day totals (step 3) are built from this field.
   */
  predictedQuantityRaw: number;
  model: ModelName;
  /** Test MAE of the model used; null when the history was too short to evaluate. */
  mae: number | null;
};

/** Chronological split of `length` days: indexes < testStart train, >= testStart test. */
export function splitChronological(length: number, testDays: number): { testStart: number } {
  return { testStart: Math.max(0, length - testDays) };
}

function metricsOf(errors: number[]): ModelMetrics {
  const absErrorSum = errors.reduce((sum, error) => sum + Math.abs(error), 0);
  const squaredErrorSum = errors.reduce((sum, error) => sum + error * error, 0);
  const n = errors.length;
  return { mae: absErrorSum / n, rmse: Math.sqrt(squaredErrorSum / n), n, absErrorSum, squaredErrorSum };
}

export function evaluateProduct(series: DailySeries, options: { testDays?: number } = {}): ProductEvaluation {
  const { values, dates } = series;
  const length = values.length;
  const testDays = options.testDays ?? DEFAULT_TEST_DAYS;
  const base = {
    productId: series.productId,
    productName: series.productName,
    seriesDays: length,
  };

  if (length < MIN_DAYS_FOR_EVALUATION || length <= testDays) {
    return { ...base, testDays: 0, trainDays: length, trainRows: 0, metrics: {}, best: "moving_average" };
  }

  const { testStart } = splitChronological(length, testDays);
  const errors: Record<ModelName, number[]> = { moving_average: [], same_weekday: [], random_forest: [] };

  for (let t = testStart; t < length; t += 1) {
    const history = values.slice(0, t);
    errors.moving_average.push(movingAveragePrediction(history) - values[t]);
    errors.same_weekday.push(sameWeekdayPrediction(history) - values[t]);
  }

  // Random Forest: trained only on target days BEFORE the first test day.
  const train = buildTrainingRows(values, dates, MIN_HISTORY_FOR_FEATURES, testStart);
  const forest = trainRandomForest(train.features, train.targets);
  if (forest) {
    for (let t = testStart; t < length; t += 1) {
      const features = computeFeatures(values.slice(0, t), dates[t]);
      if (!features) continue;
      errors.random_forest.push(forest.predict(features) - values[t]);
    }
  }

  const metrics: Partial<Record<ModelName, ModelMetrics>> = {
    moving_average: metricsOf(errors.moving_average),
    same_weekday: metricsOf(errors.same_weekday),
  };
  // the forest only counts when it scored every test day
  if (forest && errors.random_forest.length === testDays) metrics.random_forest = metricsOf(errors.random_forest);

  let best: ModelName = "moving_average";
  for (const name of MODEL_PREFERENCE) {
    const candidate = metrics[name];
    if (candidate && (!metrics[best] || candidate.mae < (metrics[best]?.mae ?? Infinity))) best = name;
  }

  return { ...base, testDays, trainDays: testStart, trainRows: train.features.length, metrics, best };
}

/**
 * Predictions for the next `horizon` days after the last day of the series,
 * with the model chosen by evaluateProduct (or the moving average when the
 * history is too short). Multi-day horizons are recursive: day k+1 sees the
 * raw predictions of days 1..k as if they were history.
 */
export function forecastProduct(
  series: DailySeries,
  evaluation: ProductEvaluation,
  options: { horizon?: number } = {},
): SalesPrediction[] {
  const horizon = Math.min(Math.max(Math.trunc(options.horizon ?? 1), 1), 7);
  const lastDate = series.dates[series.dates.length - 1];
  if (!lastDate) return [];

  let model = evaluation.best;
  let forest: Regressor | null = null;
  if (model === "random_forest") {
    // Refit on the whole history: every target day is in the past of the forecast.
    const all = buildTrainingRows(series.values, series.dates, MIN_HISTORY_FOR_FEATURES, series.values.length);
    forest = trainRandomForest(all.features, all.targets);
    if (!forest) model = "moving_average";
  }

  const history = [...series.values];
  const out: SalesPrediction[] = [];
  for (let k = 1; k <= horizon; k += 1) {
    const date = addDays(lastDate, k);
    let raw: number;
    if (model === "random_forest" && forest) {
      const features = computeFeatures(history, date);
      raw = features ? forest.predict(features) : movingAveragePrediction(history);
    } else if (model === "same_weekday") {
      raw = sameWeekdayPrediction(history);
    } else {
      raw = movingAveragePrediction(history);
    }
    history.push(Math.max(0, raw));
    out.push({
      productId: series.productId,
      productName: series.productName,
      predictionDate: date,
      horizonDay: k,
      predictedQuantity: roundToUnits(raw),
      predictedQuantityRaw: clampNonNegative(raw),
      model,
      mae: evaluation.metrics[model]?.mae ?? null,
    });
  }
  return out;
}

/**
 * Sum of a product's daily predictions up to `days`, from the UNROUNDED
 * `predictedQuantityRaw` field, then rounded once at the end - summing
 * already-rounded daily values would lose a small demand (0.4/day rounds to
 * 0 every day). Shared by the live purchase-recommendation path and the
 * step-4 snapshot builder, which must compute the exact same numbers.
 */
export function sumForecastDays(predictions: SalesPrediction[], days: number): number {
  return Math.round(
    predictions.filter((p) => p.horizonDay <= days).reduce((sum, p) => sum + p.predictedQuantityRaw, 0),
  );
}

export type ModelSummary = { mae: number; rmse: number; testObservations: number };

/**
 * Overall scores. Only products evaluated with ALL THREE models are compared
 * ("comparable"), so the three figures are measured on the very same days.
 * Baselines are also given over every evaluated product.
 */
export function summarizeEvaluations(evaluations: ProductEvaluation[]) {
  const total = (list: ProductEvaluation[], name: ModelName): ModelSummary | null => {
    let abs = 0;
    let squared = 0;
    let n = 0;
    for (const evaluation of list) {
      const metrics = evaluation.metrics[name];
      if (!metrics) continue;
      abs += metrics.absErrorSum;
      squared += metrics.squaredErrorSum;
      n += metrics.n;
    }
    return n === 0 ? null : { mae: abs / n, rmse: Math.sqrt(squared / n), testObservations: n };
  };
  const comparable = evaluations.filter((evaluation) => MODEL_PREFERENCE.every((name) => evaluation.metrics[name]));
  const evaluated = evaluations.filter((evaluation) => evaluation.testDays > 0);
  return {
    productsTotal: evaluations.length,
    productsEvaluated: evaluated.length,
    productsComparable: comparable.length,
    comparable: {
      moving_average: total(comparable, "moving_average"),
      same_weekday: total(comparable, "same_weekday"),
      random_forest: total(comparable, "random_forest"),
    },
    baselinesOverAllEvaluated: {
      moving_average: total(evaluated, "moving_average"),
      same_weekday: total(evaluated, "same_weekday"),
    },
    bestModelCounts: MODEL_PREFERENCE.reduce(
      (counts, name) => ({ ...counts, [name]: evaluated.filter((evaluation) => evaluation.best === name).length }),
      {} as Record<ModelName, number>,
    ),
    minRandomForestTrainRows: MIN_RANDOM_FOREST_TRAIN_ROWS,
  };
}
