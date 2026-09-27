import { trailingMean, mean } from "./features";

/**
 * Forecasting step 2 - the two baselines. Both receive only the history known
 * before the day to predict (values of the previous days, oldest first).
 */

export const MOVING_AVERAGE_WINDOW = 7;
export const SAME_WEEKDAY_OCCURRENCES = 4;

/** Baseline 1: mean of the last 7 days (fewer if the history is shorter). */
export function movingAveragePrediction(history: number[]): number {
  return trailingMean(history, MOVING_AVERAGE_WINDOW);
}

/**
 * Baseline 2: mean of the same weekday over the last 4 weeks. The target day
 * is at index history.length, so its previous same weekdays are 7, 14, 21 and
 * 28 days back. Falls back to the moving average when there is none yet.
 */
export function sameWeekdayPrediction(history: number[]): number {
  const n = history.length;
  const samples: number[] = [];
  for (let week = 1; week <= SAME_WEEKDAY_OCCURRENCES; week += 1) {
    const index = n - 7 * week;
    if (index >= 0) samples.push(history[index]);
  }
  return samples.length > 0 ? mean(samples) : movingAveragePrediction(history);
}
