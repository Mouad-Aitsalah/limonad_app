/**
 * Forecasting step 2 - temporal features for ONE product's daily series.
 *
 * Leakage is impossible by construction: computeFeatures() only receives the
 * history that is KNOWN before the target day (values of the days strictly
 * before it) and the target day's calendar date. Nothing from the target day
 * or later ever reaches it.
 */

export const FEATURE_NAMES = [
  "lag_1",
  "lag_2",
  "lag_3",
  "lag_7",
  "lag_14",
  "lag_28",
  "rolling_mean_7",
  "rolling_mean_14",
  "rolling_mean_28",
  "rolling_std_7",
  "day_of_week",
  "is_weekend",
  "trend_7",
] as const;

/** Longest lag: a target day needs at least this many previous days. */
export const MIN_HISTORY_FOR_FEATURES = 28;

/** 0 = Sunday ... 6 = Saturday, from a "YYYY-MM-DD" business day. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Population standard deviation (the whole window is the population). */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

/** Mean of the last `window` values of `history` (all of them if fewer). */
export function trailingMean(history: number[], window: number): number {
  return mean(history.slice(Math.max(0, history.length - window)));
}

/**
 * Features of the day `date`, from `history` = the daily quantities of the
 * days BEFORE it, oldest first, the last element being the day just before
 * `date`. Returns null when fewer than 28 previous days are known.
 *
 * trend_7 = mean(last 7 days) - mean(the 7 days before those): the recent
 * direction of the demand.
 */
export function computeFeatures(history: number[], date: string): number[] | null {
  const n = history.length;
  if (n < MIN_HISTORY_FOR_FEATURES) return null;
  const lag = (k: number) => history[n - k];
  const last7 = history.slice(n - 7);
  const previous7 = history.slice(n - 14, n - 7);
  return [
    lag(1),
    lag(2),
    lag(3),
    lag(7),
    lag(14),
    lag(28),
    mean(last7),
    trailingMean(history, 14),
    trailingMean(history, 28),
    stdDev(last7),
    dayOfWeek(date),
    isWeekend(date) ? 1 : 0,
    mean(last7) - mean(previous7),
  ];
}

export type TrainingRows = { features: number[][]; targets: number[]; dates: string[] };

/**
 * Supervised rows for the target days with index in [fromIndex, toIndex[ of a
 * consecutive daily series: features from the days before each target, target
 * = that day's quantity. Days without 28 days of history are skipped.
 */
export function buildTrainingRows(
  values: number[],
  dates: string[],
  fromIndex: number,
  toIndex: number,
): TrainingRows {
  const rows: TrainingRows = { features: [], targets: [], dates: [] };
  for (let t = Math.max(fromIndex, MIN_HISTORY_FOR_FEATURES); t < toIndex; t += 1) {
    const features = computeFeatures(values.slice(0, t), dates[t]);
    if (!features) continue;
    rows.features.push(features);
    rows.targets.push(values[t]);
    rows.dates.push(dates[t]);
  }
  return rows;
}
