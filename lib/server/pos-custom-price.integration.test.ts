import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import { buildSyncPayload } from "@/lib/offline/driver-pos/sync-payload";

/**
 * Custom unit price on a POS sale line, through the REAL server code against a THROWAWAY PostgreSQL
 * database (counter sale: admin / cashier honoured, depot manager not; driver sale: online and offline
 * sync). The session comes from a real Session row (Bearer token); only `next/headers` is replaced.
 *
 * What is proved: the price typed is the price sold (line, total), the product's catalogue price and
 * purchase price are never touched, the cost frozen on the line is the product's, stock moves normally,
 * 0 DH is a real price, a negative / non-numeric price is refused, and a role that may not set a price
 * sells at the catalogue price whatever the request carries.
 *
 * Safety: the file does nothing unless D2_TEST_DATABASE_URL names the local database `commdis_d2_test`
 * AND DATABASE_URL is that very URL, and node's module mocks are on (`--experimental-test-module-mocks`,
 * passed through by the `npm run test:db` wrapper).
 */

const D2 = process.env.D2_TEST_DATABASE_URL;
function isThrowaway(url: string | undefined): boolean {
  if (!url || process.env.DATABASE_URL !== url) return false;
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) && parsed.port === "5432" && parsed.pathname === "/commdis_d2_test";
  } catch {
    return false;
  }
}
const enabled = isThrowaway(D2);
const mocksAvailable = typeof (mock as unknown as { module?: unknown }).module === "function";
const SKIP = !enabled
  ? "D2_TEST_DATABASE_URL is not the throwaway database commdis_d2_test (use the wrapper)"
  : !mocksAvailable
    ? "node module mocks unavailable: add --experimental-test-module-mocks"
    : false;

let prisma: PrismaClient;
let currentToken: string | null = null;
let counter: typeof import("@/lib/server/counter-sales");
let driverSales: typeof import("@/lib/server/driver-sales");
let tokens: typeof import("@/lib/server/offline-price-token");

before(async () => {
  if (SKIP) return;
  // test-only signing secret for the offline price tokens (never a real one)
  process.env.OFFLINE_PRICE_SIGNING_SECRET = `test-${randomUUID()}`;
  mock.module("next/headers", {
    namedExports: {
      headers: async () => new Headers(currentToken ? { authorization: `Bearer ${currentToken}` } : {}),
      cookies: async () => ({ get: () => undefined, set: () => undefined }),
    },
  });
  prisma = (await import("@/lib/prisma")).prisma;
  counter = await import("@/lib/server/counter-sales");
  driverSales = await import("@/lib/server/driver-sales");
  tokens = await import("@/lib/server/offline-price-token");
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (!SKIP) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);
type Role = "admin" | "cashier" | "depot_manager" | "driver";
const DB_ROLE = { admin: "ADMIN", cashier: "CASHIER", depot_manager: "DEPOT_MANAGER", driver: "DRIVER" } as const;

/** Catalogue: 100 HT (120 TTC at 20 %), purchase price 12.5 HT. Depot stock 100, truck stock 50. */
async function makeOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `PCP-${label}-${suffix}`.toUpperCase(), name: `Prix ${label}` } });
  const depotRow = await prisma.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot principal", address: "-", city: "-" } });
  const depotLocation = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot principal", type: "DEPOT", depotId: depotRow.id } });
  const truckRow = await prisma.truck.create({ data: { organizationId: organization.id, code: `T-${suffix}`, registration: `REG-${suffix}`, depotId: depotRow.id } });
  const truckLocation = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `T-${suffix}`, name: "Camion 1", type: "TRUCK", truckId: truckRow.id } });

  const tokensByRole = {} as Record<Role, string>;
  const userIds = {} as Record<Role, string>;
  for (const role of ["admin", "cashier", "depot_manager", "driver"] as const) {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        firstName: role,
        lastName: label,
        fullName: `${role} ${label}`,
        email: `pcp-${role}-${suffix}@example.invalid`,
        passwordHash: "x",
        role: DB_ROLE[role],
        depotId: depotRow.id,
      },
    });
    const token = `tok-${role}-${suffix}-${randomUUID()}`;
    await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    tokensByRole[role] = token;
    userIds[role] = user.id;
  }
  const driverRow = await prisma.driver.create({ data: { organizationId: organization.id, employeeCode: `E-${suffix}`, userId: userIds.driver, truckId: truckRow.id, active: true } });

  const category = await prisma.category.create({ data: { organizationId: organization.id, name: "Boissons" } });
  const product = await prisma.product.create({
    data: { organizationId: organization.id, reference: `P-${suffix}`, name: "Sidi Ali 2 L", categoryId: category.id, purchasePrice: 12.5, salePrice: 100, taxRate: 20, unit: "unite" },
  });
  await prisma.stockLevel.create({ data: { organizationId: organization.id, productId: product.id, locationId: depotLocation.id, quantity: 100, reservedQuantity: 0 } });
  await prisma.stockLevel.create({ data: { organizationId: organization.id, productId: product.id, locationId: truckLocation.id, quantity: 50, reservedQuantity: 0 } });
  // A second, cheaper product (10 HT = 12 TTC, cost 4 HT): the paying line next to a free one.
  const second = await prisma.product.create({
    data: { organizationId: organization.id, reference: `Q-${suffix}`, name: "Eau 1 L", categoryId: category.id, purchasePrice: 4, salePrice: 10, taxRate: 20, unit: "unite" },
  });
  await prisma.stockLevel.create({ data: { organizationId: organization.id, productId: second.id, locationId: depotLocation.id, quantity: 100, reservedQuantity: 0 } });
  await prisma.stockLevel.create({ data: { organizationId: organization.id, productId: second.id, locationId: truckLocation.id, quantity: 50, reservedQuantity: 0 } });
  return {
    secondProductId: second.id,
    id: organization.id,
    tokens: tokensByRole,
    userIds,
    depotLocationId: depotLocation.id,
    truckLocationId: truckLocation.id,
    driverId: driverRow.id,
    productId: product.id,
  };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

const as = (org: Org, role: Role) => {
  currentToken = org.tokens[role];
};

async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => {
    const failure = error as { status?: number; message?: string };
    assert.equal(failure.status, status, `status ${failure.status}: ${failure.message}`);
    return true;
  });
}

async function productRow(org: Org) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: org.productId } });
  return { salePrice: product.salePrice.toNumber(), purchasePrice: product.purchasePrice.toNumber(), taxRate: product.taxRate.toNumber() };
}

async function stockAt(locationId: string, org: Org) {
  return (await prisma.stockLevel.findFirstOrThrow({ where: { productId: org.productId, locationId } })).quantity;
}

async function saleLines(saleId: string) {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: true } });
  return {
    totalTTC: sale.totalTTC.toNumber(),
    status: sale.status,
    lines: sale.lines.map((line) => ({
      unitPriceHT: line.unitPriceHT.toNumber(),
      unitCostHT: line.unitCostHT.toNumber(),
      quantity: line.quantity,
      totalHT: line.totalHT.toNumber(),
      totalTTC: line.totalTTC.toNumber(),
    })),
  };
}

const counterSale = (org: Org, line: Record<string, unknown>) =>
  counter.createCounterSale({ paymentMethod: "CASH", lines: [{ productId: org.productId, quantity: 2, ...line }] } as never);
const driverSale = (org: Org, line: Record<string, unknown>) =>
  driverSales.createDriverSale({ paymentMethod: "CASH", lines: [{ productId: org.productId, quantity: 2, ...line }] } as never);

// ---- counter POS -----------------------------------------------------------------------------------------------

for (const role of ["admin", "cashier"] as const) {
  test(`COUNTER (${role}): the typed price is the price sold - line, total, cost, stock - and the catalogue is untouched`, { skip: SKIP }, async () => {
    const org = await makeOrg(`c-${role}`);
    as(org, role);
    const before = await productRow(org);

    // 15 DH TTC typed = 12.50 HT, 2 units -> 30.00 TTC (catalogue: 120.00 TTC each)
    const sale = await counterSale(org, { unitPriceHT: 12.5 });
    const stored = await saleLines(sale.id);
    assert.deepEqual(stored.lines, [{ unitPriceHT: 12.5, unitCostHT: 12.5, quantity: 2, totalHT: 25, totalTTC: 30 }]);
    assert.equal(stored.totalTTC, 30, "the sale total follows the typed price");
    assert.equal(sale.totalTTC, 30);

    assert.deepEqual(await productRow(org), before, "salePrice, purchasePrice and VAT of the product are unchanged");
    assert.equal(await stockAt(org.depotLocationId, org), 98, "stock moves normally (-2)");

    // the next sale without a typed price is back at the catalogue price: nothing was kept
    const plain = await counterSale(org, {});
    assert.deepEqual((await saleLines(plain.id)).lines[0], { unitPriceHT: 100, unitCostHT: 12.5, quantity: 2, totalHT: 200, totalTTC: 240 });
    // and the first sale kept its own (historical) price
    assert.equal((await saleLines(sale.id)).lines[0].unitPriceHT, 12.5);
    assert.equal(await stockAt(org.depotLocationId, org), 96);
  });

  test(`COUNTER (${role}): 0 DH is a real price - a free line next to a paying one, never the catalogue price`, { skip: SKIP }, async () => {
    const org = await makeOrg(`z-${role}`);
    as(org, role);
    const sale = await counter.createCounterSale({
      paymentMethod: "CASH",
      lines: [
        { productId: org.productId, quantity: 2, unitPriceHT: 0 },
        { productId: org.secondProductId, quantity: 1 },
      ],
    } as never);
    const stored = await saleLines(sale.id);
    const free = stored.lines.find((line) => line.unitCostHT === 12.5)!;
    const paying = stored.lines.find((line) => line.unitCostHT === 4)!;
    assert.deepEqual(free, { unitPriceHT: 0, unitCostHT: 12.5, quantity: 2, totalHT: 0, totalTTC: 0 }, "the free line stays free");
    assert.deepEqual(paying, { unitPriceHT: 10, unitCostHT: 4, quantity: 1, totalHT: 10, totalTTC: 12 });
    assert.equal(stored.totalTTC, 12, "the total is the paying line only");
    assert.equal((await productRow(org)).salePrice, 100, "the catalogue price is untouched");
    assert.equal(await stockAt(org.depotLocationId, org), 98, "the free line still moves stock");
  });
}

test("COUNTER: an invoice whose whole total is 0 DH is refused up front (422, clear message) - nothing is written", { skip: SKIP }, async () => {
  const org = await makeOrg("allzero");
  as(org, "cashier");
  const salesBefore = await prisma.sale.count({ where: { organizationId: org.id } });
  await assert.rejects(counterSale(org, { unitPriceHT: 0 }), (error: unknown) => {
    const failure = error as { status?: number; message?: string };
    assert.equal(failure.status, 422);
    assert.match(failure.message ?? "", /total de la vente doit etre superieur a 0 DH/);
    return true;
  });
  assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), salesBefore);
  assert.equal(await stockAt(org.depotLocationId, org), 100, "no stock moved");
  // same for the other way to reach 0 (a 100 % discount: 120 TTC off a 120 TTC price) - it used to fail inside the accounting
  await rejectsWith(counterSale(org, { discountUnitAmount: 120 }), 422);
  assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), salesBefore);
});

test("COUNTER: a negative, non-numeric or absurd price is refused (422) and nothing is written", { skip: SKIP }, async () => {
  const org = await makeOrg("bad");
  as(org, "cashier");
  const salesBefore = await prisma.sale.count({ where: { organizationId: org.id } });
  for (const bad of [-1, -0.01, "abc", "", 1e15]) {
    await rejectsWith(counterSale(org, { unitPriceHT: bad }), 422);
  }
  assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), salesBefore);
  assert.equal(await stockAt(org.depotLocationId, org), 100);
});

test("COUNTER: the depot manager may not set a price - the request's price is ignored, the sale is at the catalogue price", { skip: SKIP }, async () => {
  const org = await makeOrg("depot");
  as(org, "depot_manager");
  const sale = await counterSale(org, { unitPriceHT: 1 });
  assert.deepEqual((await saleLines(sale.id)).lines[0], { unitPriceHT: 100, unitCostHT: 12.5, quantity: 2, totalHT: 200, totalTTC: 240 });
  assert.equal((await saleLines(sale.id)).totalTTC, 240);
});

test("COUNTER: the product's cost reaches the admin and the cashier POS, never the depot manager's", { skip: SKIP }, async () => {
  const org = await makeOrg("cost");
  const cost = async (role: Role) => {
    as(org, role);
    const context = await counter.getCounterPosContext();
    return context.products.find((product) => product.id === org.productId)?.purchasePriceHT;
  };
  assert.equal(await cost("admin"), 12.5);
  assert.equal(await cost("cashier"), 12.5);
  assert.equal(await cost("depot_manager"), undefined);
});

// ---- driver POS ---------------------------------------------------------------------------------------------------

test("DRIVER (online): the typed price is the price sold - line, total, cost, truck stock - and the catalogue is untouched", { skip: SKIP }, async () => {
  const org = await makeOrg("d-online");
  as(org, "driver");
  const before = await productRow(org);

  const sale = await driverSale(org, { customUnitPriceTTC: 15 });
  const stored = await saleLines(sale.id);
  assert.deepEqual(stored.lines, [{ unitPriceHT: 12.5, unitCostHT: 12.5, quantity: 2, totalHT: 25, totalTTC: 30 }]);
  assert.equal(stored.totalTTC, 30);
  assert.deepEqual(await productRow(org), before);
  assert.equal(await stockAt(org.truckLocationId, org), 48, "truck stock moves normally (-2)");
  assert.equal(await stockAt(org.depotLocationId, org), 100, "depot stock untouched");

  // without a typed price: catalogue price, exactly as before this feature
  const plain = await driverSale(org, {});
  assert.deepEqual((await saleLines(plain.id)).lines[0], { unitPriceHT: 100, unitCostHT: 12.5, quantity: 2, totalHT: 200, totalTTC: 240 });
});

test("DRIVER (online): 0 DH is a real price on a line next to a paying one; a negative price, null or a string is refused (422)", { skip: SKIP }, async () => {
  const org = await makeOrg("d-zero");
  as(org, "driver");
  const mixed = await driverSales.createDriverSale({
    paymentMethod: "CASH",
    lines: [
      { productId: org.productId, quantity: 2, customUnitPriceTTC: 0 },
      { productId: org.secondProductId, quantity: 1 },
    ],
  } as never);
  const stored = await saleLines(mixed.id);
  assert.deepEqual(stored.lines.find((line) => line.unitCostHT === 12.5), { unitPriceHT: 0, unitCostHT: 12.5, quantity: 2, totalHT: 0, totalTTC: 0 });
  assert.equal(stored.totalTTC, 12, "the total is the paying line only");
  assert.equal(await stockAt(org.truckLocationId, org), 48, "the free line still moves stock");

  const salesBefore = await prisma.sale.count({ where: { organizationId: org.id } });
  for (const bad of [-1, null, "15", "", Number.NaN, 1e15]) {
    await rejectsWith(driverSale(org, { customUnitPriceTTC: bad }), 422);
  }
  assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), salesBefore, "nothing written by a refused price");
  assert.equal(await stockAt(org.truckLocationId, org), 48, "a refused price moves no stock");
});

test("DRIVER: an invoice whose whole total is 0 DH is refused up front (422, clear message) - nothing is written", { skip: SKIP }, async () => {
  const org = await makeOrg("d-allzero");
  as(org, "driver");
  await assert.rejects(driverSale(org, { customUnitPriceTTC: 0 }), (error: unknown) => {
    const failure = error as { status?: number; message?: string };
    assert.equal(failure.status, 422);
    assert.match(failure.message ?? "", /total de la vente doit etre superieur a 0 DH/);
    return true;
  });
  assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), 0);
  assert.equal(await stockAt(org.truckLocationId, org), 50, "no stock moved");
});

test("DRIVER: the product's cost reaches the driver POS context", { skip: SKIP }, async () => {
  const org = await makeOrg("d-cost");
  as(org, "driver");
  const context = await driverSales.getDriverPosContext();
  const product = context.products.find((item) => item.id === org.productId);
  assert.equal(product?.purchasePriceHT, 12.5);
  assert.equal(product?.salePriceTTC, 120);
});

test("DRIVER: only a driver reaches the driver sale - a cashier or an admin is refused (403)", { skip: SKIP }, async () => {
  const org = await makeOrg("d-roles");
  for (const role of ["cashier", "admin", "depot_manager"] as const) {
    as(org, role);
    await rejectsWith(driverSale(org, { customUnitPriceTTC: 1 }), 403);
  }
  assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), 0);
});

test("DRIVER (offline sync): the signed catalogue price is verified, then the typed price is the price sold", { skip: SKIP }, async () => {
  const org = await makeOrg("d-sync");
  as(org, "driver");
  const priceToken = tokens.signOfflinePrice({ organizationId: org.id, productId: org.productId, unitPriceTTC: 120 });

  const synced = await driverSales.syncOfflineDriverSale({
    clientMutationId: randomUUID(),
    soldAt: new Date(Date.now() - 60_000).toISOString(),
    paymentMethod: "CASH",
    roundingAmount: 0,
    lines: [{ productId: org.productId, quantity: 2, unitPriceTTC: 120, priceToken, discountRate: 0, customUnitPriceTTC: 15 }],
  });
  assert.equal(synced.result, "CREATED");
  assert.equal(synced.serverTotalTTC, 30);
  assert.deepEqual((await saleLines(synced.serverSaleId)).lines, [{ unitPriceHT: 12.5, unitCostHT: 12.5, quantity: 2, totalHT: 25, totalTTC: 30 }]);
  assert.equal((await productRow(org)).salePrice, 100);
  assert.equal(await stockAt(org.truckLocationId, org), 48);

  // a free line synchronises as a free line, next to a paying one
  const secondToken = tokens.signOfflinePrice({ organizationId: org.id, productId: org.secondProductId, unitPriceTTC: 12 });
  const free = await driverSales.syncOfflineDriverSale({
    clientMutationId: randomUUID(),
    soldAt: new Date(Date.now() - 30_000).toISOString(),
    paymentMethod: "CASH",
    roundingAmount: 0,
    lines: [
      { productId: org.productId, quantity: 1, unitPriceTTC: 120, priceToken, discountRate: 0, customUnitPriceTTC: 0 },
      { productId: org.secondProductId, quantity: 1, unitPriceTTC: 12, priceToken: secondToken, discountRate: 0 },
    ],
  });
  assert.equal(free.serverTotalTTC, 12);
  assert.equal((await saleLines(free.serverSaleId)).lines.find((line) => line.unitCostHT === 12.5)?.unitPriceHT, 0);

  // a line with no typed price is still priced from the signed catalogue price, as before
  const plain = await driverSales.syncOfflineDriverSale({
    clientMutationId: randomUUID(),
    soldAt: new Date(Date.now() - 20_000).toISOString(),
    paymentMethod: "CASH",
    roundingAmount: 0,
    lines: [{ productId: org.productId, quantity: 1, unitPriceTTC: 120, priceToken, discountRate: 0 }],
  });
  assert.equal(plain.serverTotalTTC, 120);
});

test("DRIVER (offline sync): a plain 20 DH x 2 line (no discount) goes from the device payload to a synchronised sale", { skip: SKIP }, async () => {
  const org = await makeOrg("d-plain20");
  as(org, "driver");
  const product = await prisma.product.create({
    data: { organizationId: org.id, reference: `T20-${uid()}`, name: "Produit 20 DH", categoryId: (await prisma.category.findFirstOrThrow({ where: { organizationId: org.id } })).id, purchasePrice: 10, salePrice: 16.67, taxRate: 20, unit: "unite" },
  });
  await prisma.stockLevel.create({ data: { organizationId: org.id, productId: product.id, locationId: org.truckLocationId, quantity: 50, reservedQuantity: 0 } });
  const priceToken = tokens.signOfflinePrice({ organizationId: org.id, productId: product.id, unitPriceTTC: 20 });
  const clientMutationId = randomUUID();

  // what the driver cart stored offline for 2 x 20 DH (TTC-first: 40.00 TTC = 33.33 HT + 6.67 VAT)
  const built = buildSyncPayload({
    localId: "local",
    clientMutationId,
    localReference: "OFF-20X2",
    soldAt: new Date(Date.now() - 60_000).toISOString(),
    customerId: null,
    paymentMethod: "CASH",
    totalTTC: 40,
    roundingAmount: 0,
    lines: [
      { id: "l1", offlineSaleId: "local", productId: product.id, productNameSnapshot: "Produit 20 DH", quantity: 2, unitPriceSnapshot: 20, taxRateSnapshot: 20, discountSnapshot: 0, totalHT: 33.33, taxAmount: 6.67, totalTTC: 40, priceToken },
    ],
  } as never);
  assert.ok(built.ok, "the plain line is no longer refused by the device");

  const synced = await driverSales.syncOfflineDriverSale(built.body as never);
  assert.equal(synced.result, "CREATED");
  assert.equal(synced.serverTotalTTC, 40);
  assert.equal(synced.totalMismatch, false, "the server total equals the ticket the driver showed");
  assert.deepEqual((await saleLines(synced.serverSaleId)).lines, [{ unitPriceHT: 16.67, unitCostHT: 10, quantity: 2, totalHT: 33.33, totalTTC: 40 }]);
  const truckStock = await prisma.stockLevel.findFirstOrThrow({ where: { productId: product.id, locationId: org.truckLocationId } });
  assert.equal(truckStock.quantity, 48, "truck stock moved by the 2 units sold");
});

test("DRIVER (offline sync): the token still guards the catalogue price - a forged catalogue price is refused even with a typed price", { skip: SKIP }, async () => {
  const org = await makeOrg("d-forged");
  as(org, "driver");
  const priceToken = tokens.signOfflinePrice({ organizationId: org.id, productId: org.productId, unitPriceTTC: 120 });
  await assert.rejects(
    driverSales.syncOfflineDriverSale({
      clientMutationId: randomUUID(),
      soldAt: new Date(Date.now() - 60_000).toISOString(),
      paymentMethod: "CASH",
      roundingAmount: 0,
      lines: [{ productId: org.productId, quantity: 1, unitPriceTTC: 1, priceToken, discountRate: 0, customUnitPriceTTC: 1 }],
    }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_OFFLINE_PRICE_TOKEN",
  );
  assert.equal(await prisma.sale.count({ where: { organizationId: org.id } }), 0);
});
