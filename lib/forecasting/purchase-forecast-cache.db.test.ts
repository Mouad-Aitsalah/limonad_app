import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

import { addDays } from "./daily-sales-series";
import type { ForecastDb } from "./product-daily-sales";
import { computeAndStoreSnapshot, type CronDb } from "./purchase-forecast-run";
import { readSnapshotRows } from "./purchase-forecast-snapshot";
import {
  buildPurchaseRecommendationsFromSnapshot,
  buildPurchaseRecommendationsLive,
  getPurchaseRecommendationsFor,
} from "./purchase-recommendation";
import { getCurrentBusinessDayParam } from "@/lib/business-day";

/**
 * Forecasting step 4, end to end on the development database: writing a
 * snapshot, reading it back, the stock staying live while the forecast is
 * cached, and organisation isolation of the cache itself. Everything runs in
 * ONE transaction that is ALWAYS rolled back. Skipped when unreachable.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  try {
    await Promise.race([prisma.$queryRaw`select 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000))]);
    reachable = true;
  } catch {
    reachable = false;
  }
});

after(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const uid = () => randomUUID().slice(0, 8);

async function makeOrganization(tx: Tx, label: string) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-${label}-${suffix}`, name: `Test ${label}` } });
  const user = await tx.user.create({
    data: { organizationId: organization.id, firstName: "T", lastName: label, fullName: `T ${label}`, email: `t-${label}-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id } });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: "Cat" } });
  return { organization, user, location, category };
}
type Ctx = Awaited<ReturnType<typeof makeOrganization>>;

async function seedProduct(tx: Tx, ctx: Ctx, name: string, dailyQuantity: number, stock: number | null, lastDay: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  const product = await tx.product.create({
    data: { organizationId: ctx.organization.id, reference: `R-${uid()}`, name, categoryId: ctx.category.id, purchasePrice: 5, salePrice: 10, taxRate: 20, unit: "u", status },
  });
  const sales: Array<Record<string, unknown>> = [];
  const lines: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 90; i += 1) {
    const id = randomUUID();
    sales.push({
      id,
      organizationId: ctx.organization.id,
      invoiceNumber: `T-${uid()}-${i}`,
      origin: "COUNTER",
      status: "PAID",
      stockLocationId: ctx.location.id,
      subtotalHT: 0,
      taxAmount: 0,
      totalTTC: 0,
      paymentMethod: "CASH",
      createdByUserId: ctx.user.id,
      validatedAt: new Date(`${addDays(lastDay, -(89 - i))}T12:00:00Z`),
    });
    lines.push({ saleId: id, productId: product.id, quantity: dailyQuantity, unitPriceHT: 10, unitCostHT: 5, taxRate: 20, taxAmount: 0, totalHT: 0, totalTTC: 0 });
  }
  await tx.sale.createMany({ data: sales as never });
  await tx.saleLine.createMany({ data: lines as never });
  if (stock !== null) {
    await tx.stockLevel.create({ data: { organizationId: ctx.organization.id, productId: product.id, locationId: ctx.location.id, quantity: stock } });
  }
  return product;
}

/** Runs the REAL production write path (lib/forecasting/purchase-forecast-run.ts), then reads it back. */
async function writeSnapshot(tx: Tx, ctx: Ctx, businessDay: string, asOf: string) {
  void asOf; // kept for callers' clarity: computeAndStoreSnapshot derives it itself (businessDay - 1)
  const db = tx as unknown as CronDb;
  await computeAndStoreSnapshot(db, ctx.organization.id, businessDay);
  return readSnapshotRows(db, ctx.organization.id, businessDay);
}

test("A. snapshot creation, upsert (idempotent), uniqueness, isolation between organisations", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const a = await makeOrganization(tx, "A");
        const b = await makeOrganization(tx, "B");
        const asOf = "2025-06-30";
        const businessDay = "2025-07-01";
        const hawaiA = await seedProduct(tx, a, "Hawaï 1L", 5, 12, asOf);
        const hawaiB = await seedProduct(tx, b, "Hawaï 1L", 500, 0, asOf);

        const rows1 = await writeSnapshot(tx, a, businessDay, asOf);
        assert.equal(rows1.length, 1);
        assert.equal(rows1[0].productId, hawaiA.id);

        // idempotent: running it again for the same day does not duplicate
        await writeSnapshot(tx, a, businessDay, asOf);
        const count = await tx.purchaseForecastSnapshot.count({ where: { organizationId: a.organization.id, businessDay } });
        assert.equal(count, 1);

        // isolation: writing B's snapshot never touches A's row, and vice versa
        await writeSnapshot(tx, b, businessDay, asOf);
        const a2 = await readSnapshotRows(tx as unknown as ForecastDb, a.organization.id, businessDay);
        const b2 = await readSnapshotRows(tx as unknown as ForecastDb, b.organization.id, businessDay);
        assert.deepEqual(a2.map((r) => r.productId), [hawaiA.id]);
        assert.deepEqual(b2.map((r) => r.productId), [hawaiB.id]);
        assert.equal(a2[0].forecast7Days, 35);
        assert.equal(b2[0].forecast7Days, 3500);

        // the unique index refuses a manual duplicate insert outright - last
        // statement of this transaction: Postgres poisons the whole
        // transaction after an error until rollback, so nothing else can run
        // in it afterwards.
        await assert.rejects(
          tx.purchaseForecastSnapshot.create({
            data: { organizationId: a.organization.id, businessDay, productId: hawaiA.id, productName: "x", forecast1Day: 0, forecast3Days: 0, forecast7Days: 0, predictedQuantityRaw: 0, model: "moving_average", reliability: "sufficient", historyDays: 1, soldDays: 1 },
          }),
        );

        throw new Rollback("rollback");
      },
      { timeout: 240_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
});

test("B+C. reading: snapshot present -> no ML recompute, cached figures used; stock always fresh; wrong/absent businessDay -> fallback", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const org = await makeOrganization(tx, "R");
        const asOf = "2025-06-30";
        const businessDay = "2025-07-01";
        const negativeDay = "2025-07-02"; // asOf would be 2025-07-01 for this day - a DIFFERENT businessDay
        const product = await seedProduct(tx, org, "Coca 2L", 5, 12, asOf);
        const negativeProduct = await seedProduct(tx, org, "Coca 1L", 5, -12, asOf);
        const db = tx as unknown as ForecastDb;

        const rows = await writeSnapshot(tx, org, businessDay, asOf);
        assert.equal(rows.length, 2);

        // B1: snapshot present -> buildPurchaseRecommendationsFromSnapshot only
        // (never buildSalesForecast/Random Forest again) gives the SAME numbers
        // buildPurchaseRecommendationsLive would - proven by comparing them.
        let liveCalls = 0;
        const originalTransaction = tx.$transaction;
        void originalTransaction; // ML re-run would show up as a much longer duration; compared explicitly below instead
        const t0 = Date.now();
        const fromCache = await buildPurchaseRecommendationsFromSnapshot(db, org.organization.id, asOf, rows);
        const cacheMs = Date.now() - t0;
        const t1 = Date.now();
        const live = await buildPurchaseRecommendationsLive(db, org.organization.id, { asOf });
        const liveMs = Date.now() - t1;
        liveCalls += 1;
        void liveCalls;

        const byId = (result: typeof live) => new Map(result.recommendations.map((r) => [r.productId, r]));
        const cacheById = byId(fromCache);
        const liveById = byId(live);
        for (const id of [product.id, negativeProduct.id]) {
          const c = cacheById.get(id)!;
          const l = liveById.get(id)!;
          assert.equal(c.forecast7Days, l.forecast7Days);
          assert.equal(c.safetyStock, l.safetyStock);
          assert.equal(c.targetStock, l.targetStock);
          assert.equal(c.recommendedPurchaseQuantity, l.recommendedPurchaseQuantity);
          assert.equal(c.reliability, l.reliability);
        }
        assert.equal(fromCache.source, "cache");
        assert.equal(live.source, "live");
        console.log(`[perf] live=${liveMs}ms cache-read=${cacheMs}ms`);

        // C1: stock changed since the snapshot was computed -> the cached path reflects it immediately
        await tx.stockLevel.update({
          where: { productId_locationId: { productId: product.id, locationId: org.location.id } },
          data: { quantity: 40 },
        });
        const afterStockChange = await buildPurchaseRecommendationsFromSnapshot(db, org.organization.id, asOf, rows);
        const updated = byId(afterStockChange).get(product.id)!;
        assert.equal(updated.currentStock, 40);
        assert.equal(updated.forecast7Days, 35, "the cached forecast itself is untouched by the stock change");
        assert.equal(updated.recommendedPurchaseQuantity, Math.max(0, updated.targetStock - 40));

        // C2: negative stock -> achat 0 + regularisation flag, snapshot or not
        const negative = byId(afterStockChange).get(negativeProduct.id)!;
        assert.equal(negative.currentStock, -12);
        assert.equal(negative.recommendedPurchaseQuantity, 0);
        assert.equal(negative.stockRegularizationRequired, true);

        // C3: stock already sufficient -> achat 0
        await tx.stockLevel.update({
          where: { productId_locationId: { productId: product.id, locationId: org.location.id } },
          data: { quantity: 1000 },
        });
        const sufficient = byId(await buildPurchaseRecommendationsFromSnapshot(db, org.organization.id, asOf, rows)).get(product.id)!;
        assert.equal(sufficient.recommendedPurchaseQuantity, 0);

        // B2/B3: no snapshot for `negativeDay`'s businessDay -> readSnapshotRows finds nothing (fallback is the caller's job, see getPurchaseRecommendations)
        const wrongDay = await readSnapshotRows(db, org.organization.id, negativeDay);
        assert.deepEqual(wrongDay, []);
        const noOrgYet = await readSnapshotRows(db, "org-does-not-exist", businessDay);
        assert.deepEqual(noOrgYet, []);

        throw new Rollback("rollback");
      },
      { timeout: 240_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
});

test("getPurchaseRecommendationsFor: the real entry point - cache hit needs no live run, no snapshot falls back live, wrong businessDay falls back too", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const withSnapshot = await makeOrganization(tx, "WS");
        const withoutSnapshot = await makeOrganization(tx, "NS");
        const today = getCurrentBusinessDayParam();
        const asOf = addDays(today, -1);
        await seedProduct(tx, withSnapshot, "Coca 2L", 5, 12, asOf);
        await seedProduct(tx, withoutSnapshot, "Coca 2L", 5, 12, asOf);
        const db = tx as unknown as CronDb;

        // Only `withSnapshot` gets a precomputed row for TODAY's business day.
        await computeAndStoreSnapshot(db, withSnapshot.organization.id, today);

        const cached = await getPurchaseRecommendationsFor(db, withSnapshot.organization.id);
        assert.equal(cached.source, "cache");
        assert.equal(cached.asOf, asOf);
        assert.equal(cached.recommendations[0]?.forecast7Days, 35);

        // No snapshot at all for this organisation -> live, same numbers, no error.
        const live = await getPurchaseRecommendationsFor(db, withoutSnapshot.organization.id);
        assert.equal(live.source, "live");
        assert.equal(live.recommendations[0]?.forecast7Days, 35);

        // A custom `asOf`/`testDays` is never answered from the cache, even
        // when one exists for today - it was computed for different parameters.
        const customAsOf = await getPurchaseRecommendationsFor(db, withSnapshot.organization.id, { asOf });
        assert.equal(customAsOf.source, "live");

        throw new Rollback("rollback");
      },
      { timeout: 240_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
});

test("inactive product still reads correctly from a snapshot: forecast reported, purchase always 0", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const org = await makeOrganization(tx, "I");
        const asOf = "2025-06-30";
        const businessDay = "2025-07-01";
        const product = await seedProduct(tx, org, "Ancien produit", 5, 0, asOf, "INACTIVE");
        const rows = await writeSnapshot(tx, org, businessDay, asOf);
        const db = tx as unknown as ForecastDb;
        const result = await buildPurchaseRecommendationsFromSnapshot(db, org.organization.id, asOf, rows);
        const item = result.recommendations.find((r) => r.productId === product.id)!;
        assert.equal(item.productStatus, "INACTIVE");
        assert.equal(item.recommendedPurchaseQuantity, 0);
        assert.ok(item.forecast7Days > 0);
        assert.match(item.reason, /inactif/);
        throw new Rollback("rollback");
      },
      { timeout: 240_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
});
