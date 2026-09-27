import "dotenv/config";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import type { SaleStatus } from "@/lib/generated/prisma/client";

import { buildProductDailySalesDataset, getProductDailySalesCoverage, REAL_SALE_STATUSES, type ForecastDb } from "./product-daily-sales";

/**
 * Real-SQL tests of the aggregation. Everything is written inside ONE
 * transaction that is ALWAYS rolled back (a sentinel error at the end): no row
 * ever stays in the database. Skipped when the database is unreachable.
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

async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await work(tx);
        throw new Rollback("rollback");
      },
      { timeout: 180_000, maxWait: 30_000 },
    ),
    (error: unknown) => error instanceof Rollback,
  );
}

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter += 1)}`;

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
  const depot = await tx.depot.create({
    data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" },
  });
  const location = await tx.stockLocation.create({
    data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id },
  });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: "Cat" } });
  return { organization, user, location, category };
}

type Ctx = Awaited<ReturnType<typeof makeOrganization>>;

async function makeProduct(tx: Tx, ctx: Ctx, name: string, createdAt?: Date) {
  return tx.product.create({
    data: {
      organizationId: ctx.organization.id,
      reference: `R-${uid()}`,
      name,
      categoryId: ctx.category.id,
      purchasePrice: 5,
      salePrice: 10,
      taxRate: 20,
      unit: "u",
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

async function makeSale(
  tx: Tx,
  ctx: Ctx,
  input: { status: SaleStatus; validatedAt: string | null; soldAt?: string; lines: Array<{ productId: string; quantity: number }> },
) {
  await tx.sale.create({
    data: {
      organizationId: ctx.organization.id,
      invoiceNumber: `T-${uid()}`,
      origin: "COUNTER",
      status: input.status,
      stockLocationId: ctx.location.id,
      subtotalHT: 0,
      taxAmount: 0,
      totalTTC: 0,
      paymentMethod: "CASH",
      createdByUserId: ctx.user.id,
      validatedAt: input.validatedAt ? new Date(input.validatedAt) : null,
      soldAt: input.soldAt ? new Date(input.soldAt) : null,
      lines: {
        create: input.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPriceHT: 10,
          unitCostHT: 5,
          taxRate: 20,
          taxAmount: 0,
          totalHT: 0,
          totalTTC: 0,
        })),
      },
    },
  });
}

const key = (r: { date: string; productId: string }) => `${r.productId}|${r.date}`;

test("SQL aggregation: sums per Produit x Jour, separates products, business days, valid statuses, soldAt, organisations", async (t) => {
  if (!reachable) return t.skip("database unreachable");

  await inRolledBackTransaction(async (tx) => {
    const a = await makeOrganization(tx, "A");
    const b = await makeOrganization(tx, "B");
    const hawai = await makeProduct(tx, a, "Hawaï 1L");
    const coca = await makeProduct(tx, a, "Coca 1L");
    const fanta = await makeProduct(tx, a, "Fanta 1L", new Date("2025-01-03T12:00:00Z"));
    const neverSold = await makeProduct(tx, a, "Jamais vendu", new Date("2025-01-02T12:00:00Z"));
    const hawaiB = await makeProduct(tx, b, "Hawaï 1L");

    // 1. Several sales of the same product the same day are summed (3 + 5 + 4 = 12) ...
    await makeSale(tx, a, { status: "PAID", validatedAt: "2025-01-01T10:00:00Z", lines: [{ productId: hawai.id, quantity: 3 }] });
    await makeSale(tx, a, {
      status: "PAID",
      validatedAt: "2025-01-01T15:00:00Z",
      lines: [{ productId: hawai.id, quantity: 5 }, { productId: coca.id, quantity: 2 }],
    });
    await makeSale(tx, a, { status: "CREDIT_NOTED", validatedAt: "2025-01-01T20:00:00Z", lines: [{ productId: hawai.id, quantity: 4 }] });
    // ... 4. invalid sales are ignored (DRAFT, CANCELLED)
    await makeSale(tx, a, { status: "DRAFT", validatedAt: null, lines: [{ productId: hawai.id, quantity: 100 }] });
    await makeSale(tx, a, { status: "CANCELLED", validatedAt: "2025-01-01T11:00:00Z", lines: [{ productId: hawai.id, quantity: 100 }] });
    // 5. business day: 00:30 UTC on the 2nd = 01:30 in Casablanca -> still day 01 (+1); 02:30 local -> day 02
    await makeSale(tx, a, { status: "PAID", validatedAt: "2025-01-02T00:30:00Z", lines: [{ productId: hawai.id, quantity: 1 }] });
    await makeSale(tx, a, { status: "PAID", validatedAt: "2025-01-02T01:30:00Z", lines: [{ productId: hawai.id, quantity: 7 }] });
    // soldAt wins over validatedAt (offline sync): dated 01-04 although validated on 01-10
    await makeSale(tx, a, {
      status: "PAID",
      validatedAt: "2025-01-10T10:00:00Z",
      soldAt: "2025-01-04T10:00:00Z",
      lines: [{ productId: hawai.id, quantity: 6 }],
    });
    await makeSale(tx, a, { status: "PAID", validatedAt: "2025-01-04T09:00:00Z", lines: [{ productId: hawai.id, quantity: 2 }, { productId: fanta.id, quantity: 1 }] });
    // 3. another organisation, same product name, same day: never mixed
    await makeSale(tx, b, { status: "PAID", validatedAt: "2025-01-01T10:00:00Z", lines: [{ productId: hawaiB.id, quantity: 50 }] });

    const db = tx as unknown as ForecastDb;

    // sparse
    const sparseA = await buildProductDailySalesDataset(db, a.organization.id);
    const at = (productId: string, date: string) => sparseA.find((r) => r.productId === productId && r.date === date)?.quantitySold;
    assert.equal(at(hawai.id, "2025-01-01"), 13, "3+5+4 same day, plus the 01:30 local sale of the previous business day; DRAFT/CANCELLED ignored");
    assert.equal(at(hawai.id, "2025-01-02"), 7, "02:30 local starts a new business day");
    assert.equal(at(hawai.id, "2025-01-04"), 8, "2 + 6 (soldAt override)");
    assert.equal(at(hawai.id, "2025-01-10"), undefined, "the validation day of the offline sale gets nothing");
    assert.equal(at(hawai.id, "2025-01-03"), undefined, "sparse: no zero rows");
    assert.equal(at(coca.id, "2025-01-01"), 2, "products of the same day are separated");
    assert.equal(at(fanta.id, "2025-01-04"), 1);
    assert.equal(sparseA.some((r) => r.productId === hawaiB.id), false, "organisation B never appears in A");
    assert.equal(new Set(sparseA.map(key)).size, sparseA.length, "no Produit x Jour duplicate");

    const sparseB = await buildProductDailySalesDataset(db, b.organization.id);
    assert.deepEqual(sparseB.map((r) => [r.date, r.productId, r.quantitySold]), [["2025-01-01", hawaiB.id, 50]]);

    // from / to bounds (business days, both included)
    const bounded = await buildProductDailySalesDataset(db, a.organization.id, { from: "2025-01-02", to: "2025-01-02" });
    assert.deepEqual(bounded.map((r) => [r.date, r.productId, r.quantitySold]), [["2025-01-02", hawai.id, 7]]);

    // 6. complete series: zeros for the empty days, nothing before the product existed
    const complete = await buildProductDailySalesDataset(db, a.organization.id, { complete: true });
    const series = (productId: string) => complete.filter((r) => r.productId === productId).map((r) => [r.date, r.quantitySold]);
    assert.deepEqual(series(hawai.id), [["2025-01-01", 13], ["2025-01-02", 7], ["2025-01-03", 0], ["2025-01-04", 8]]);
    assert.deepEqual(series(fanta.id), [["2025-01-03", 0], ["2025-01-04", 1]], "starts at its creation day");
    assert.deepEqual(series(coca.id), [["2025-01-01", 2], ["2025-01-02", 0], ["2025-01-03", 0], ["2025-01-04", 0]]);
    assert.deepEqual(series(neverSold.id), [], "products without sales are left out by default");
    assert.equal(new Set(complete.map(key)).size, complete.length, "no duplicate in the complete series either");
    assert.equal(complete.some((r) => r.productId === hawaiB.id), false);

    const withUnsold = await buildProductDailySalesDataset(db, a.organization.id, { complete: true, includeProductsWithoutSales: true });
    assert.deepEqual(
      withUnsold.filter((r) => r.productId === neverSold.id).map((r) => [r.date, r.quantitySold]),
      [["2025-01-02", 0], ["2025-01-03", 0], ["2025-01-04", 0]],
    );

    // coverage figures
    const coverage = await getProductDailySalesCoverage(db, a.organization.id);
    assert.equal(coverage.minDate, "2025-01-01");
    assert.equal(coverage.maxDate, "2025-01-04");
    assert.equal(coverage.dayCount, 3);
    assert.equal(coverage.productCount, 3);
    assert.equal(coverage.salesCount, 7, "DRAFT and CANCELLED sales are not counted");
    assert.equal(coverage.soldQuantity, 13 + 7 + 8 + 2 + 1);
    assert.equal(coverage.returnedQuantity, 0);
  });
});

test("the sales perimeter is exactly the BI one (no DRAFT / CANCELLED)", () => {
  assert.deepEqual([...REAL_SALE_STATUSES], ["VALIDATED", "PARTIALLY_PAID", "PAID", "CREDIT", "CREDIT_NOTED"]);
});
