import assert from "node:assert/strict";
import { test } from "node:test";

import type { SalesPrediction } from "./forecast-engine";
import { summarizeEvaluations } from "./forecast-engine";
import type { ForecastDb } from "./product-daily-sales";
import { runPurchaseForecastSnapshot, type CronDb } from "./purchase-forecast-run";
import {
  buildSnapshotRows,
  isMissingColumnError,
  parseDailyForecast,
  readLatestSnapshot,
} from "./purchase-forecast-snapshot";
import type { SalesForecastResult } from "./sales-forecast";

function prediction(day: number, raw: number): SalesPrediction {
  return {
    productId: "p1",
    productName: "Coca 2L",
    predictionDate: `2026-10-0${day}`,
    horizonDay: day,
    predictedQuantity: Math.round(raw),
    predictedQuantityRaw: raw,
    model: "moving_average",
    mae: 0.5,
  };
}

function forecast(): SalesForecastResult {
  return {
    asOf: "2026-10-02",
    horizon: 7,
    predictions: [prediction(3, 1.234), prediction(1, 0.4), prediction(2, 2)],
    evaluations: [],
    series: [{ productId: "p1", productName: "Coca 2L", dates: ["2026-10-01", "2026-10-02"], values: [1, 2] }],
    summary: summarizeEvaluations([]),
  };
}

test("snapshot rows now carry when they were computed and the per-day predictions (unrounded to 1/100, in date order)", () => {
  const computedAt = new Date("2026-10-03T00:10:00.000Z");
  const [row] = buildSnapshotRows("org1", "2026-10-03", forecast(), computedAt);
  assert.equal(row.computedAt, computedAt);
  assert.deepEqual(row.dailyForecast, [
    { date: "2026-10-01", quantity: 0.4 },
    { date: "2026-10-02", quantity: 2 },
    { date: "2026-10-03", quantity: 1.23 },
  ]);
  // the existing figures are unchanged by the new fields
  assert.equal(row.forecast7Days, Math.round(0.4 + 2 + 1.234));
});

test("parseDailyForecast accepts only a well-formed stored array", () => {
  assert.deepEqual(parseDailyForecast([{ date: "2026-10-03", quantity: 1.5 }]), [{ date: "2026-10-03", quantity: 1.5 }]);
  for (const bad of [null, undefined, "x", {}, [], [{ date: "03/10", quantity: 1 }], [{ date: "2026-10-03", quantity: -1 }], [{ date: "2026-10-03", quantity: "1" }], [null]]) {
    assert.equal(parseDailyForecast(bad), null, JSON.stringify(bad));
  }
});

test("isMissingColumnError recognises the Prisma code and the Postgres message, nothing else", () => {
  assert.equal(isMissingColumnError(Object.assign(new Error("x"), { code: "P2022" })), true);
  assert.equal(isMissingColumnError(new Error('column "computedAt" of relation "PurchaseForecastSnapshot" does not exist')), true);
  assert.equal(isMissingColumnError(new Error("connection refused")), false);
  assert.equal(isMissingColumnError(Object.assign(new Error("x"), { code: "P2002" })), false);
  assert.equal(isMissingColumnError(null), false);
});

test("readLatestSnapshot: nothing cached -> null; otherwise the latest day not after today", async () => {
  let asked: unknown;
  const db = {
    purchaseForecastSnapshot: {
      findFirst: async (args: unknown) => {
        asked = args;
        return null;
      },
    },
  } as unknown as ForecastDb;
  assert.equal(await readLatestSnapshot(db, "org1", "2026-10-03"), null);
  assert.deepEqual((asked as { where: unknown }).where, { organizationId: "org1", businessDay: { lte: "2026-10-03" } });
});

test("readLatestSnapshot: a failure that is not a missing column is NOT swallowed", async () => {
  const db = {
    purchaseForecastSnapshot: {
      findFirst: async () => ({ businessDay: "2026-10-03" }),
      findMany: async () => {
        throw new Error("connection refused");
      },
    },
  } as unknown as ForecastDb;
  await assert.rejects(readLatestSnapshot(db, "org1", "2026-10-03"), /connection refused/);
});

// ---- the cron write path ------------------------------------------------------------------------

type UpsertArgs = { create: Record<string, unknown>; update: Record<string, unknown> };

function cronDb(upserts: UpsertArgs[], opts: { failWithExtras?: boolean } = {}): CronDb {
  return {
    organization: { findMany: async () => [{ id: "org1", code: "O1" }] },
    product: { findMany: async () => [{ id: "p1", name: "Coca 2L", createdAt: new Date("2026-01-01T00:00:00Z") }] },
    $queryRaw: async () => {
      // the sparse daily sales rows of the history: sixty sale days
      const rows = [];
      for (let i = 0; i < 60; i += 1) {
        const date = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10);
        rows.push({ day: date, productId: "p1", productName: "Coca 2L", quantity: 3 });
      }
      return rows;
    },
    purchaseForecastSnapshot: {
      upsert: async (args: UpsertArgs) => {
        if (opts.failWithExtras && "computedAt" in args.create) {
          throw Object.assign(new Error("The column `PurchaseForecastSnapshot.computedAt` does not exist in the current database."), {
            code: "P2022",
          });
        }
        upserts.push(args);
        return {};
      },
    },
  } as unknown as CronDb;
}

test("cron: writes computedAt and the daily detail with the row when the columns exist", async () => {
  const upserts: UpsertArgs[] = [];
  const summary = await runPurchaseForecastSnapshot(cronDb(upserts), { businessDay: "2026-10-03" });
  assert.equal(summary.organizationsSucceeded, 1);
  assert.equal(upserts.length, 1);
  const { create, update } = upserts[0];
  assert.ok(create.computedAt instanceof Date);
  assert.ok(Array.isArray(create.dailyForecast) && (create.dailyForecast as unknown[]).length === 7);
  assert.ok(update.computedAt instanceof Date);
  assert.ok(Array.isArray(update.dailyForecast));
});

test("cron: before the migration the run still succeeds, writing the previous shape", async () => {
  const upserts: UpsertArgs[] = [];
  const summary = await runPurchaseForecastSnapshot(cronDb(upserts, { failWithExtras: true }), { businessDay: "2026-10-03" });
  assert.equal(summary.organizationsSucceeded, 1, JSON.stringify(summary.results));
  assert.equal(upserts.length, 1);
  assert.equal("computedAt" in upserts[0].create, false);
  assert.equal("dailyForecast" in upserts[0].create, false);
  assert.equal("computedAt" in upserts[0].update, false);
  assert.equal(upserts[0].create.forecast7Days !== undefined, true);
});
