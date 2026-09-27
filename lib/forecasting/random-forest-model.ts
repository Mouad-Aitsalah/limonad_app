import { RandomForestRegression } from "ml-random-forest";

/**
 * Forecasting step 2 - Random Forest regressor (ml-random-forest, the
 * TypeScript/JavaScript counterpart of scikit-learn's RandomForestRegressor:
 * bagged CART regression trees averaged). The app runs on Node (Vercel), which
 * cannot execute Python/scikit-learn, and nothing in the project used ML yet.
 * Deterministic: a fixed seed, so the same data always gives the same forest.
 */

export const RANDOM_FOREST_OPTIONS = {
  nEstimators: 60,
  maxFeatures: 0.7,
  replacement: true,
  seed: 42,
  useSampleBagging: true,
  noOOB: true,
  selectionMethod: "mean",
  treeOptions: { minNumSamples: 3, maxDepth: 12 },
} as const;

/** Fewer supervised rows than this and the forest is not trained at all. */
export const MIN_RANDOM_FOREST_TRAIN_ROWS = 30;

export type Regressor = { predict(features: number[]): number };

/** Never negative: a quantity sold cannot be below 0. */
export function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Whole units: rounded to the nearest unit, never below 0. */
export function roundToUnits(value: number): number {
  return Math.round(clampNonNegative(value));
}

export function trainRandomForest(features: number[][], targets: number[]): Regressor | null {
  if (features.length < MIN_RANDOM_FOREST_TRAIN_ROWS) return null;
  const forest = new RandomForestRegression(RANDOM_FOREST_OPTIONS as never);
  forest.train(features, targets);
  return {
    predict: (row) => clampNonNegative(forest.predict([row])[0]),
  };
}
