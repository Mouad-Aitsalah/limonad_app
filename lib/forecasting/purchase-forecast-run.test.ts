import assert from "node:assert/strict";
import { test } from "node:test";

import { runPurchaseForecastSnapshot, type CronDb } from "./purchase-forecast-run";

/**
 * Pure orchestration tests (fake db, no network): organisation selection,
 * per-organisation error isolation, and the summary counts. The end-to-end
 * behaviour (a real forecast actually written and read back) is covered by
 * lib/forecasting/purchase-forecast-cache.db.test.ts and the idempotence /
 * "active organisations" tests further down in this file (real, rolled-back
 * database).
 */

type FakeOrg = { id: string; code: string; status: "ACTIVE" | "INACTIVE"; fails?: boolean };

/** A minimal CronDb: enough for computeAndStoreSnapshot's whole call chain, with zero products (fast, deterministic). */
function fakeDb(organizations: FakeOrg[]): CronDb {
  const fake = {
    organization: {
      findMany: async (args: { where?: { id?: string; status?: string } }) => {
        if (args?.where?.id) return organizations.filter((o) => o.id === args.where!.id).map(({ id, code }) => ({ id, code }));
        return organizations.filter((o) => o.status === "ACTIVE").map(({ id, code }) => ({ id, code }));
      },
    },
    product: {
      findMany: async (args: { where?: { organizationId?: string } }) => {
        const org = organizations.find((o) => o.id === args?.where?.organizationId);
        if (org?.fails) throw new Error(`Panne simulée pour ${org.id}`);
        return [];
      },
    },
    $queryRaw: async () => [],
    purchaseForecastSnapshot: {
      upsert: async () => ({}),
    },
  };
  return fake as unknown as CronDb;
}

test("D3. an INACTIVE organisation is ignored by default (no organizationId given)", async () => {
  const db = fakeDb([
    { id: "a", code: "A", status: "ACTIVE" },
    { id: "b", code: "B", status: "INACTIVE" },
  ]);
  const summary = await runPurchaseForecastSnapshot(db, {});
  assert.deepEqual(summary.results.map((r) => r.organizationId), ["a"]);
  assert.equal(summary.organizationsTotal, 1);
});

test("D4. several organisations are all processed", async () => {
  const db = fakeDb([
    { id: "a", code: "A", status: "ACTIVE" },
    { id: "b", code: "B", status: "ACTIVE" },
    { id: "c", code: "C", status: "ACTIVE" },
  ]);
  const summary = await runPurchaseForecastSnapshot(db, {});
  assert.equal(summary.organizationsTotal, 3);
  assert.equal(summary.organizationsSucceeded, 3);
  assert.equal(summary.organizationsFailed, 0);
  assert.deepEqual(summary.results.map((r) => r.organizationId).sort(), ["a", "b", "c"]);
});

test("D6. one organisation failing never blocks the others - A ok, B error, C ok", async () => {
  const db = fakeDb([
    { id: "a", code: "A", status: "ACTIVE" },
    { id: "b", code: "B", status: "ACTIVE", fails: true },
    { id: "c", code: "C", status: "ACTIVE" },
  ]);
  const summary = await runPurchaseForecastSnapshot(db, {});
  assert.equal(summary.organizationsTotal, 3);
  assert.equal(summary.organizationsSucceeded, 2);
  assert.equal(summary.organizationsFailed, 1);
  const byId = new Map(summary.results.map((r) => [r.organizationId, r]));
  assert.equal(byId.get("a")!.ok, true);
  assert.equal(byId.get("c")!.ok, true);
  const failed = byId.get("b")!;
  assert.equal(failed.ok, false);
  assert.match((failed as { error: string }).error, /Panne simulée/);
});

test("5. recalcul manuel: a given organizationId only ever processes that ONE organisation, active or not", async () => {
  const db = fakeDb([
    { id: "a", code: "A", status: "ACTIVE" },
    { id: "b", code: "B", status: "INACTIVE" },
  ]);
  const summary = await runPurchaseForecastSnapshot(db, { organizationId: "b" });
  assert.deepEqual(summary.results.map((r) => r.organizationId), ["b"]);
});

test("10. the summary always reports total/succeeded/failed, and per-organisation results", async () => {
  const db = fakeDb([
    { id: "a", code: "A", status: "ACTIVE" },
    { id: "b", code: "B", status: "ACTIVE", fails: true },
  ]);
  const summary = await runPurchaseForecastSnapshot(db, { businessDay: "2026-09-14" });
  assert.equal(summary.businessDay, "2026-09-14");
  assert.equal(summary.organizationsTotal, summary.organizationsSucceeded + summary.organizationsFailed);
  assert.equal(summary.results.length, summary.organizationsTotal);
  assert.ok(summary.durationMs >= 0);
});

test("an unknown organizationId simply yields zero organisations, no crash", async () => {
  const db = fakeDb([{ id: "a", code: "A", status: "ACTIVE" }]);
  const summary = await runPurchaseForecastSnapshot(db, { organizationId: "does-not-exist" });
  assert.equal(summary.organizationsTotal, 0);
});
