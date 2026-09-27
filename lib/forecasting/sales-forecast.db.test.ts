import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

import { addDays } from "./daily-sales-series";
import type { ForecastDb } from "./product-daily-sales";
import { buildSalesForecast } from "./sales-forecast";

/**
 * Real-SQL test of the organisation-level forecast. Everything is written in
 * ONE transaction that is ALWAYS rolled back: no row stays in the database.
 * Skipped when the database is unreachable.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  try {
    await Promise.race([
      prisma.$queryRaw`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
    ]);
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
    data: {
      organizationId: organization.id,
      firstName: "T",
      lastName: label,
      fullName: `T ${label}`,
      email: `t-${label}-${suffix}@example.invalid`,
      passwordHash: "x",
      role: "ADMIN",
    },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await tx.stockLocation.create({
    data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id },
  });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: "Cat" } });
  return { organization, user, location, category };
}

/** One PAID sale of `quantity` per day for `days` days ending on `lastDay`, in two bulk inserts. */
async function seedDailySales(
  tx: Tx,
  ctx: Awaited<ReturnType<typeof makeOrganization>>,
  productId: string,
  lastDay: string,
  days: number,
  quantityOf: (index: number) => number,
) {
  const sales: Array<Record<string, unknown>> = [];
  const lines: Array<Record<string, unknown>> = [];
  for (let i = 0; i < days; i += 1) {
    const id = randomUUID();
    const day = addDays(lastDay, -(days - 1 - i));
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
      validatedAt: new Date(`${day}T12:00:00Z`),
    });
    lines.push({ saleId: id, productId, quantity: quantityOf(i), unitPriceHT: 10, unitCostHT: 5, taxRate: 20, taxAmount: 0, totalHT: 0, totalTTC: 0 });
  }
  await tx.sale.createMany({ data: sales as never });
  await tx.saleLine.createMany({ data: lines as never });
}

test("organisation isolation: each forecast only contains its own organisation's products", async (t) => {
  if (!reachable) return t.skip("database unreachable");

  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const a = await makeOrganization(tx, "A");
        const b = await makeOrganization(tx, "B");
        const product = (ctx: typeof a, name: string) =>
          tx.product.create({
            data: { organizationId: ctx.organization.id, reference: `R-${uid()}`, name, categoryId: ctx.category.id, purchasePrice: 5, salePrice: 10, taxRate: 20, unit: "u" },
          });
        const hawaiA = await product(a, "Hawaï 1L");
        const hawaiB = await product(b, "Hawaï 1L"); // same name, other organisation

        const asOf = "2025-06-30";
        await seedDailySales(tx, a, hawaiA.id, asOf, 90, (i) => 3 + (i % 7)); // ~5 a day in A
        await seedDailySales(tx, b, hawaiB.id, asOf, 90, () => 500); // 500 a day in B

        const db = tx as unknown as ForecastDb;
        const forecastA = await buildSalesForecast(db, a.organization.id, { asOf, horizon: 3 });
        const forecastB = await buildSalesForecast(db, b.organization.id, { asOf, horizon: 3 });

        assert.deepEqual([...new Set(forecastA.predictions.map((p) => p.productId))], [hawaiA.id]);
        assert.deepEqual([...new Set(forecastB.predictions.map((p) => p.productId))], [hawaiB.id]);
        assert.equal(forecastA.evaluations.length, 1);
        assert.equal(forecastB.evaluations.length, 1);

        // A's demand is ~5/day: B's 500/day never leaks into it
        assert.ok(forecastA.predictions.every((p) => p.predictedQuantity <= 12), JSON.stringify(forecastA.predictions));
        assert.ok(forecastB.predictions.every((p) => p.predictedQuantity >= 400));
        assert.deepEqual(forecastA.predictions.map((p) => p.predictionDate), ["2025-07-01", "2025-07-02", "2025-07-03"]);
        assert.ok(forecastA.predictions.every((p) => Number.isInteger(p.predictedQuantity) && p.predictedQuantity >= 0));

        // the history stops at asOf: a later organisation-wide sale-free day count is complete series only up to asOf
        assert.equal(forecastA.evaluations[0].seriesDays, 90);

        throw new Rollback("rollback");
      },
      { timeout: 180_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
});
