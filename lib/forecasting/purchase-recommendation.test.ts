import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProductStatus } from "@/lib/generated/prisma/client";

import {
  assessReliability,
  computeRecommendation,
  computeSafetyStock,
  type RecommendationInput,
} from "./purchase-recommendation";

/** 40 days alternating 10 / 0: last 28 days = 14 x 10 + 14 x 0 -> mean 5, sigma 5. */
const IRREGULAR_HISTORY = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 10 : 0));
const IRREGULAR_RECENT = IRREGULAR_HISTORY.slice(-28);

function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    productId: "p1",
    productName: "Coca 33cl",
    productStatus: "ACTIVE" as ProductStatus,
    currentStock: 15,
    forecast1Day: 5,
    forecast3Days: 15,
    forecast7Days: 35,
    model: "moving_average",
    mae: 0.5,
    historyDays: IRREGULAR_HISTORY.length,
    soldDays: IRREGULAR_HISTORY.filter((v) => v > 0).length,
    recentValues: IRREGULAR_RECENT,
    ...overrides,
  };
}

test("formula: target = forecast + safety stock, purchase = max(0, target - stock) - the documented example", () => {
  const result = computeRecommendation(input());
  assert.equal(result.forecast7Days, 35);
  assert.equal(result.safetyStock, 17, "ceil(1.28 * 5 * sqrt(7)) = ceil(16.93)");
  assert.equal(result.safetyStockRule, "demand_variability");
  assert.equal(result.targetStock, 52);
  assert.equal(result.currentStock, 15);
  assert.equal(result.recommendedPurchaseQuantity, 37);
  assert.match(result.reason, /inférieur au stock cible \(52 = 35 prévus sur 7 jours \+ 17 de sécurité\)/);
});

test("enough stock: nothing to buy, and the reason says so", () => {
  const result = computeRecommendation(input({ currentStock: 500 }));
  assert.equal(result.recommendedPurchaseQuantity, 0);
  assert.match(result.reason, /couvre le stock cible/);
  assert.equal(computeRecommendation(input({ currentStock: 52 })).recommendedPurchaseQuantity, 0, "exactly the target");
  assert.equal(computeRecommendation(input({ currentStock: 51 })).recommendedPurchaseQuantity, 1);
});

test("1/3/7-day forecasts are passed through as given (already summed from the unrounded daily predictions upstream)", () => {
  const result = computeRecommendation(input({ forecast1Day: 10, forecast3Days: 30, forecast7Days: 65 }));
  assert.equal(result.forecast1Day, 10);
  assert.equal(result.forecast3Days, 30);
  assert.equal(result.forecast7Days, 65);
  // 0.4 a day rounds to 0 every day, but the week is ~3 units: the caller (sumForecastDays) must not lose them - here we just confirm the field is not re-derived/re-rounded
  const small = computeRecommendation(input({ forecast1Day: 0, forecast3Days: 1, forecast7Days: 3 }));
  assert.equal(small.forecast7Days, 3);
  assert.equal(small.forecast1Day, 0);
});

test("negative stock: reported as is, flagged for regularisation, and NEVER turned into a purchase", () => {
  const result = computeRecommendation(input({ currentStock: -5 }));
  assert.equal(result.currentStock, -5);
  assert.equal(result.stockRegularizationRequired, true);
  assert.equal(result.recommendedPurchaseQuantity, 0);
  assert.equal(result.targetStock, 52, "the forecast and target are still reported");
  assert.match(result.reason, /Stock négatif \(-5\) : aucun achat automatique n'est recommandé, le stock doit d'abord être régularisé/);
  // even a big deficit with a zero forecast: never "buy 105"
  const deficit = computeRecommendation(input({ currentStock: -105, forecast1Day: 0, forecast3Days: 0, forecast7Days: 0 }));
  assert.equal(deficit.recommendedPurchaseQuantity, 0);
  assert.equal(computeRecommendation(input({ currentStock: 0 })).stockRegularizationRequired, false);
  // an inactive product with a negative stock is still flagged
  const inactive = computeRecommendation(input({ currentStock: -2, productStatus: "INACTIVE" as ProductStatus }));
  assert.equal(inactive.stockRegularizationRequired, true);
  assert.equal(inactive.recommendedPurchaseQuantity, 0);
});

test("forecast 0 and nothing sold for 28 days: no safety stock, no purchase", () => {
  const result = computeRecommendation(
    input({ historyDays: 50, soldDays: 20, recentValues: new Array(28).fill(0), forecast1Day: 0, forecast3Days: 0, forecast7Days: 0, currentStock: 0 }),
  );
  assert.equal(result.forecast7Days, 0);
  assert.equal(result.safetyStock, 0);
  assert.equal(result.safetyStockRule, "none");
  assert.equal(result.recommendedPurchaseQuantity, 0);
  assert.match(result.reason, /Aucune vente récente prévue/);
});

test("forecast 0 but sales in the last 28 days: the variability margin still applies (explicit exception)", () => {
  const result = computeRecommendation(input({ forecast1Day: 0, forecast3Days: 0, forecast7Days: 0, currentStock: 0 }));
  assert.equal(result.forecast7Days, 0);
  assert.equal(result.safetyStock, 17);
  assert.equal(result.recommendedPurchaseQuantity, 17);
});

test("a product that never sold: reliability none, recommendation 0, whatever the stock", () => {
  const result = computeRecommendation(
    input({ historyDays: 0, soldDays: 0, recentValues: [], model: null, mae: null, forecast1Day: 0, forecast3Days: 0, forecast7Days: 0, currentStock: 0 }),
  );
  assert.equal(result.reliability, "none");
  assert.equal(result.recommendedPurchaseQuantity, 0);
  assert.equal(result.model, null);
  assert.match(result.reason, /jamais vendu/);
});

test("very little history: prudent fallback (half a week of demand), flagged very limited", () => {
  const history = [0, 3, 0, 2, 4, 0, 1, 3, 2, 0]; // 10 days, 6 with sales
  const result = computeRecommendation(
    input({ historyDays: 10, soldDays: 6, recentValues: history, mae: null, forecast1Day: 2, forecast3Days: 6, forecast7Days: 14, currentStock: 4 }),
  );
  assert.equal(result.reliability, "very_limited");
  assert.equal(result.safetyStockRule, "fallback_half_week");
  assert.equal(result.forecast7Days, 14);
  assert.equal(result.safetyStock, 7);
  assert.equal(result.targetStock, 21);
  assert.equal(result.recommendedPurchaseQuantity, 17);
  assert.equal(result.mae, null);
  assert.match(result.reason, /historique très limité/);
});

test("insufficient history for the variability rule (under 28 days or under 5 sale days) uses the fallback", () => {
  assert.deepEqual(computeSafetyStock({ historyDays: 27, soldDays: 27, forecast7Days: 14, recentValues: new Array(27).fill(2) }), {
    safetyStock: 7,
    rule: "fallback_half_week",
  });
  const sparse = [0, 0, 0, 4, 0, 0, 3]; // only 2 sale days in the recent window
  assert.equal(computeSafetyStock({ historyDays: 35, soldDays: 2, forecast7Days: 4, recentValues: sparse }).rule, "fallback_half_week");
});

test("safety stock: zero variability gives zero margin; more variability gives more", () => {
  const flat = computeSafetyStock({ historyDays: 40, soldDays: 40, forecast7Days: 35, recentValues: new Array(28).fill(5) });
  assert.deepEqual(flat, { safetyStock: 0, rule: "demand_variability" });
  const irregular = computeSafetyStock({ historyDays: 40, soldDays: 20, forecast7Days: 35, recentValues: IRREGULAR_RECENT });
  assert.equal(irregular.safetyStock, 17);
  assert.ok(irregular.safetyStock > flat.safetyStock);
});

test("only the LAST 28 days (recentValues) set the margin: an old spike outside that window is ignored", () => {
  const recent = new Array(28).fill(5); // the "500" spike is 60 days back, never in this slice
  assert.equal(computeSafetyStock({ historyDays: 61, soldDays: 61, forecast7Days: 35, recentValues: recent }).safetyStock, 0);
});

test("INACTIVE and DISCONTINUED products are never recommended automatically", () => {
  for (const status of ["INACTIVE", "DISCONTINUED"] as ProductStatus[]) {
    const result = computeRecommendation(input({ productStatus: status, currentStock: 0 }));
    assert.equal(result.recommendedPurchaseQuantity, 0, status);
    assert.equal(result.productStatus, status);
    assert.match(result.reason, /aucun achat recommandé automatiquement/);
    assert.ok(result.forecast7Days > 0, "the forecast itself is still reported");
  }
});

test("a product without any StockLevel row: counted as 0, flagged, and said in the reason - never silent", () => {
  const result = computeRecommendation(input({ currentStock: null }));
  assert.equal(result.stockKnown, false);
  assert.equal(result.currentStock, 0);
  assert.equal(result.recommendedPurchaseQuantity, 52);
  assert.match(result.reason, /Aucun niveau de stock enregistré : stock considéré à 0/);
  assert.equal(computeRecommendation(input({ currentStock: 0 })).stockKnown, true);
});

test("reliability thresholds", () => {
  assert.equal(assessReliability(100, 0), "none");
  assert.equal(assessReliability(20, 20), "very_limited");
  assert.equal(assessReliability(100, 4), "very_limited");
  assert.equal(assessReliability(59, 40), "limited");
  assert.equal(assessReliability(100, 14), "limited");
  assert.equal(assessReliability(60, 15), "sufficient");
});

test("never a negative or fractional quantity, whatever the inputs; and the result is deterministic", () => {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let run = 0; run < 300; run += 1) {
    const days = Math.floor(rand() * 90);
    const history = Array.from({ length: days }, () => (rand() < 0.5 ? 0 : Math.floor(rand() * 30)));
    const stock = rand() < 0.1 ? null : Math.floor(rand() * 400) - 100;
    const status = (["ACTIVE", "INACTIVE", "DISCONTINUED"] as ProductStatus[])[Math.floor(rand() * 3)];
    const soldDays = history.filter((v) => v > 0).length;
    const args = input({
      historyDays: days,
      soldDays,
      recentValues: history.slice(-28),
      currentStock: stock,
      productStatus: status,
      forecast1Day: days === 0 ? 0 : Math.floor(rand() * 20),
      forecast3Days: days === 0 ? 0 : Math.floor(rand() * 60),
      forecast7Days: days === 0 ? 0 : Math.floor(rand() * 140),
      model: days === 0 ? null : "moving_average",
      mae: days === 0 ? null : rand() * 2,
    });
    const result = computeRecommendation(args);
    for (const value of [result.recommendedPurchaseQuantity, result.safetyStock, result.targetStock, result.forecast1Day, result.forecast3Days, result.forecast7Days]) {
      assert.ok(Number.isInteger(value) && value >= 0, JSON.stringify(result));
    }
    assert.equal(
      result.recommendedPurchaseQuantity,
      status === "ACTIVE" && result.reliability !== "none" && result.currentStock >= 0 ? Math.max(0, result.targetStock - result.currentStock) : 0,
    );
    assert.equal(result.stockRegularizationRequired, result.currentStock < 0);
    assert.deepEqual(computeRecommendation(args), result);
  }
});
