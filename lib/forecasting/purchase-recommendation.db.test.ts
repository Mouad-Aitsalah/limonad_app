import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import type { ProductStatus } from "@/lib/generated/prisma/client";

import { addDays } from "./daily-sales-series";
import { buildPurchaseRecommendationsLive } from "./purchase-recommendation";
import type { ForecastDb } from "./product-daily-sales";

/**
 * Real-SQL test of the purchase recommendation on the development database.
 * Everything is written in ONE transaction that is ALWAYS rolled back: no row
 * stays in the database. Skipped when the database is unreachable.
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
  const depotLocation = await tx.stockLocation.create({
    data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id },
  });
  const truckLocation = await tx.stockLocation.create({
    data: { organizationId: organization.id, code: `T-${suffix}`, name: "Camion", type: "TRUCK" },
  });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: "Cat" } });
  return { organization, user, depotLocation, truckLocation, category };
}

type Ctx = Awaited<ReturnType<typeof makeOrganization>>;

const makeProduct = (tx: Tx, ctx: Ctx, name: string, status: ProductStatus = "ACTIVE") =>
  tx.product.create({
    data: { organizationId: ctx.organization.id, reference: `R-${uid()}`, name, categoryId: ctx.category.id, purchasePrice: 5, salePrice: 10, taxRate: 20, unit: "u", status },
  });

async function seedDailySales(tx: Tx, ctx: Ctx, productId: string, lastDay: string, days: number, quantity: number) {
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
      stockLocationId: ctx.depotLocation.id,
      subtotalHT: 0,
      taxAmount: 0,
      totalTTC: 0,
      paymentMethod: "CASH",
      createdByUserId: ctx.user.id,
      validatedAt: new Date(`${day}T12:00:00Z`),
    });
    lines.push({ saleId: id, productId, quantity, unitPriceHT: 10, unitCostHT: 5, taxRate: 20, taxAmount: 0, totalHT: 0, totalTTC: 0 });
  }
  await tx.sale.createMany({ data: sales as never });
  await tx.saleLine.createMany({ data: lines as never });
}

test("purchase recommendation on the real database: stock over DEPOT + TRUCK, statuses, missing stock, never sold, organisations", async (t) => {
  if (!reachable) return t.skip("database unreachable");

  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const a = await makeOrganization(tx, "A");
        const b = await makeOrganization(tx, "B");
        const asOf = "2025-06-30";

        const hawai = await makeProduct(tx, a, "Hawaï 1L");
        const inactive = await makeProduct(tx, a, "Ancien produit", "INACTIVE");
        const noStock = await makeProduct(tx, a, "Sans stock");
        const neverSold = await makeProduct(tx, a, "Jamais vendu");
        const hawaiB = await makeProduct(tx, b, "Hawaï 1L");

        for (const product of [hawai, inactive, noStock]) await seedDailySales(tx, a, product.id, asOf, 90, 5);
        await seedDailySales(tx, b, hawaiB.id, asOf, 90, 500);

        // available stock = depot (10 - 2 reserved) + truck 5 = 13
        await tx.stockLevel.createMany({
          data: [
            { organizationId: a.organization.id, productId: hawai.id, locationId: a.depotLocation.id, quantity: 10, reservedQuantity: 2 },
            { organizationId: a.organization.id, productId: hawai.id, locationId: a.truckLocation.id, quantity: 5 },
            { organizationId: a.organization.id, productId: inactive.id, locationId: a.depotLocation.id, quantity: 0 },
            { organizationId: a.organization.id, productId: neverSold.id, locationId: a.depotLocation.id, quantity: 7 },
            { organizationId: b.organization.id, productId: hawaiB.id, locationId: b.depotLocation.id, quantity: 100 },
          ],
        });

        const db = tx as unknown as ForecastDb;
        const resultA = await buildPurchaseRecommendationsLive(db, a.organization.id, { asOf, includeNeverSold: true });
        const resultB = await buildPurchaseRecommendationsLive(db, b.organization.id, { asOf });
        const byName = new Map(resultA.recommendations.map((r) => [r.productName, r]));

        // constant 5 a day: forecast 35, no variability -> no safety stock, target 35, stock 13 -> buy 22
        const h = byName.get("Hawaï 1L")!;
        assert.equal(h.currentStock, 13);
        assert.equal(h.stockKnown, true);
        assert.equal(h.forecast1Day, 5);
        assert.equal(h.forecast3Days, 15);
        assert.equal(h.forecast7Days, 35);
        assert.equal(h.safetyStock, 0);
        assert.equal(h.safetyStockRule, "demand_variability");
        assert.equal(h.targetStock, 35);
        assert.equal(h.recommendedPurchaseQuantity, 22);
        assert.equal(h.model, "moving_average");
        assert.equal(h.reliability, "sufficient");

        const i = byName.get("Ancien produit")!;
        assert.equal(i.recommendedPurchaseQuantity, 0, "INACTIVE: never recommended");
        assert.equal(i.forecast7Days, 35);

        const n = byName.get("Sans stock")!;
        assert.equal(n.stockKnown, false);
        assert.equal(n.currentStock, 0);
        assert.equal(n.recommendedPurchaseQuantity, 35, "no StockLevel row -> counted as 0, flagged");
        assert.match(n.reason, /Aucun niveau de stock enregistré/);

        const never = byName.get("Jamais vendu")!;
        assert.equal(never.reliability, "none");
        assert.equal(never.recommendedPurchaseQuantity, 0);
        assert.equal(never.currentStock, 7);

        // organisation isolation, both ways; never-sold products stay out unless asked
        assert.equal(resultA.recommendations.length, 4);
        assert.deepEqual(resultB.recommendations.map((r) => r.productId), [hawaiB.id]);
        assert.equal(resultB.recommendations[0].forecast7Days, 3500);
        assert.equal(resultB.recommendations[0].currentStock, 100);
        assert.equal(resultB.recommendations[0].recommendedPurchaseQuantity, 3400);
        const withoutNever = await buildPurchaseRecommendationsLive(db, a.organization.id, { asOf });
        assert.equal(withoutNever.recommendations.some((r) => r.productName === "Jamais vendu"), false);

        // deterministic
        const again = await buildPurchaseRecommendationsLive(db, a.organization.id, { asOf, includeNeverSold: true });
        assert.deepEqual(again, resultA);
        assert.ok(resultA.recommendations.every((r) => r.recommendedPurchaseQuantity >= 0 && Number.isInteger(r.recommendedPurchaseQuantity)));

        throw new Rollback("rollback");
      },
      { timeout: 240_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
});
