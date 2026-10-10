import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import {
  CLIENT_LOGIN_MAX_FAILURES_PER_IP,
  CLIENT_ORDER_MAX_PER_HOUR,
  estimateClientCartTotal,
  formatCustomerOrderNumber,
} from "@/lib/client-portal-rules";

import {
  ClientPortalError,
  authenticateClient,
  getClientCatalogCategories,
  getClientCatalogPage,
  isClientCatalogProduct,
  listClientOrders,
  resolveClientIdentity,
  submitClientOrder,
} from "./client-portal-core";
import {
  CustomerOrderError,
  getCustomerOrderForPosCore,
  linkCustomerOrderToSale,
  listCustomerOrdersCore,
  transitionCustomerOrderCore,
} from "./customer-orders-core";

/**
 * Espace Client against the REAL local database, every test inside a
 * transaction that is always rolled back (nothing persists). Skipped when no
 * database is reachable.
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
const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);
const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";

async function inRollback(run: (tx: Tx) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await run(tx);
        throw new Rollback();
      },
      { timeout: 60_000, maxWait: 20_000 },
    ),
    Rollback,
  );
}

async function makeOrganization(tx: Tx, label: string) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-${label}-${suffix}`.toUpperCase(), name: `Test ${label}` } });
  const user = await tx.user.create({
    data: {
      organizationId: organization.id,
      firstName: "T",
      lastName: label,
      fullName: `Staff ${label}`,
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
  const category = await tx.category.create({ data: { organizationId: organization.id, name: `Boissons ${label}` } });
  return { organization, user, depotLocation, truckLocation, category };
}
type Ctx = Awaited<ReturnType<typeof makeOrganization>>;

async function product(
  tx: Tx,
  ctx: Ctx,
  name: string,
  options: { imageUrl?: string | null; status?: "ACTIVE" | "INACTIVE"; salePrice?: number; depotStock?: number; truckStock?: number } = {},
) {
  const created = await tx.product.create({
    data: {
      organizationId: ctx.organization.id,
      reference: `R-${uid()}`,
      name,
      categoryId: ctx.category.id,
      purchasePrice: 3,
      salePrice: options.salePrice ?? 4.17,
      taxRate: 20,
      unit: "u",
      status: options.status ?? "ACTIVE",
      imageUrl: options.imageUrl === undefined ? PHOTO : options.imageUrl,
    },
  });
  if (options.depotStock !== undefined) {
    await tx.stockLevel.create({
      data: { organizationId: ctx.organization.id, productId: created.id, locationId: ctx.depotLocation.id, quantity: options.depotStock },
    });
  }
  if (options.truckStock !== undefined) {
    await tx.stockLevel.create({
      data: { organizationId: ctx.organization.id, productId: created.id, locationId: ctx.truckLocation.id, quantity: options.truckStock },
    });
  }
  return created;
}

async function customer(tx: Tx, ctx: Ctx, name: string, code: string, extra: { status?: "ACTIVE" | "BLOCKED" | "INACTIVE"; type?: "COUNTER" | "GROCERY" } = {}) {
  return tx.customer.create({
    data: {
      organizationId: ctx.organization.id,
      code,
      name,
      address: "-",
      city: "-",
      type: extra.type ?? "GROCERY",
      status: extra.status ?? "ACTIVE",
      createdByUserId: ctx.user.id,
      creationOrigin: "ADMIN",
    },
  });
}

async function businessCounts(tx: Tx) {
  const [sales, payments, movements, entries, levels] = await Promise.all([
    tx.sale.count(),
    tx.payment.count(),
    tx.stockMovement.count(),
    tx.accountingEntry.count(),
    tx.stockLevel.aggregate({ _sum: { quantity: true } }),
  ]);
  return { sales, payments, movements, entries, stock: levels._sum.quantity };
}

let orderSeq = 0;
const orderDeps = (tx: Tx) => ({ db: tx, nextOrderNumber: async () => formatCustomerOrderNumber(++orderSeq + 900000) });

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test("login: org code + customer code of an ACTIVE customer (generic « Autre » allowed); every failure is the same INVALID", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRollback(async (tx) => {
    const a = await makeOrganization(tx, "A");
    const b = await makeOrganization(tx, "B");
    const autre = await customer(tx, a, "Autre", "34211", { type: "COUNTER" });
    await customer(tx, a, "Karim", "342115");
    await customer(tx, a, "Bloqué", "342116", { status: "BLOCKED" });
    await customer(tx, a, "Inactif", "342117", { status: "INACTIVE" });
    await customer(tx, b, "Client B", "342199");
    const ip = `test-${uid()}`;

    const ok = await authenticateClient(tx, { organizationCode: a.organization.code.toLowerCase(), customerCode: "3421/1" }, { ip });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.identity.customerId, autre.id);
    assert.equal(ok.ok && ok.identity.customerDisplayCode, "3421/1");

    const short = await authenticateClient(tx, { organizationCode: a.organization.code, customerCode: "15" }, { ip });
    assert.equal(short.ok && short.identity.customerName, "Karim");

    for (const attempt of [
      { organizationCode: a.organization.code, customerCode: "999999" }, // unknown customer
      { organizationCode: a.organization.code, customerCode: "342116" }, // BLOCKED
      { organizationCode: a.organization.code, customerCode: "342117" }, // INACTIVE
      { organizationCode: a.organization.code, customerCode: "342199" }, // customer of organisation B
      { organizationCode: "NOPE-ORG", customerCode: "34211" }, // unknown organisation
    ]) {
      assert.deepEqual(await authenticateClient(tx, attempt, { ip: `other-${uid()}` }), { ok: false, reason: "INVALID" });
    }

    await tx.organization.update({ where: { id: b.organization.id }, data: { status: "INACTIVE" } });
    assert.deepEqual(
      await authenticateClient(tx, { organizationCode: b.organization.code, customerCode: "342199" }, { ip: `other-${uid()}` }),
      { ok: false, reason: "INVALID" },
    );
  });
});

test("login throttle (database-backed): after the limit even the right codes are refused for that IP", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRollback(async (tx) => {
    const a = await makeOrganization(tx, "A");
    await customer(tx, a, "Karim", "342115");
    const ip = `brute-${uid()}`;
    for (let i = 0; i < CLIENT_LOGIN_MAX_FAILURES_PER_IP; i += 1) {
      const result = await authenticateClient(tx, { organizationCode: a.organization.code, customerCode: `x${i}` }, { ip });
      assert.equal(result.ok, false);
    }
    assert.deepEqual(
      await authenticateClient(tx, { organizationCode: a.organization.code, customerCode: "342115" }, { ip }),
      { ok: false, reason: "THROTTLED" },
    );
    // another IP is not blocked
    const other = await authenticateClient(tx, { organizationCode: a.organization.code, customerCode: "342115" }, { ip: `fresh-${uid()}` });
    assert.equal(other.ok, true);
  });
});

test("session re-check: a customer blocked after login, or another organisation's id, resolves to nothing", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRollback(async (tx) => {
    const a = await makeOrganization(tx, "A");
    const b = await makeOrganization(tx, "B");
    const karim = await customer(tx, a, "Karim", "342115");
    assert.equal((await resolveClientIdentity(tx, { organizationId: a.organization.id, customerId: karim.id }))?.customerName, "Karim");
    assert.equal(await resolveClientIdentity(tx, { organizationId: b.organization.id, customerId: karim.id }), null);
    await tx.customer.update({ where: { id: karim.id }, data: { status: "BLOCKED" } });
    assert.equal(await resolveClientIdentity(tx, { organizationId: a.organization.id, customerId: karim.id }), null);
  });
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

test("catalogue: only ACTIVE products of the organisation with a valid photo; no cost, margin or quantity exposed", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRollback(async (tx) => {
    const a = await makeOrganization(tx, "A");
    const b = await makeOrganization(tx, "B");
    const coca = await product(tx, a, "Coca-Cola", { depotStock: 5 });
    const hawai = await product(tx, a, "Hawaii", { truckStock: 50 }); // stock only in a truck
    const url = await product(tx, a, "Pom's", { imageUrl: "https://cdn.example.com/poms.jpg", depotStock: 0 });
    const noPhoto = await product(tx, a, "Sans photo", { imageUrl: null });
    const emptyPhoto = await product(tx, a, "Photo vide", { imageUrl: "data:image/png;base64," });
    const svg = await product(tx, a, "Svg", { imageUrl: `data:image/svg+xml;base64,${PHOTO.slice(22)}` });
    const inactive = await product(tx, a, "Inactif", { status: "INACTIVE" });
    const foreign = await product(tx, b, "Coca-Cola B");

    const page = await getClientCatalogPage(tx, a.organization.id);
    assert.deepEqual(page.products.map((p) => p.name).sort(), ["Coca-Cola", "Hawaii", "Pom's"]);
    for (const hidden of [noPhoto, emptyPhoto, svg, inactive, foreign]) {
      assert.equal(page.products.some((p) => p.id === hidden.id), false, hidden.name);
    }
    const byName = new Map(page.products.map((p) => [p.name, p]));
    assert.equal(byName.get("Coca-Cola")!.priceTTC, 5);
    assert.equal(byName.get("Coca-Cola")!.available, true);
    assert.equal(byName.get("Hawaii")!.available, false, "truck stock is not depot availability");
    assert.equal(byName.get("Pom's")!.available, false);
    assert.equal(byName.get("Pom's")!.imageUrl, "https://cdn.example.com/poms.jpg");
    assert.match(byName.get("Coca-Cola")!.imageUrl, new RegExp(`^/api/products/${coca.id}/image\\?v=\\d+$`));
    for (const field of ["purchasePrice", "salePrice", "quantity", "availableQuantity", "margin", "organizationId"]) {
      assert.equal(field in byName.get("Coca-Cola")!, false, field);
    }

    // server-side search + pagination
    assert.deepEqual((await getClientCatalogPage(tx, a.organization.id, { q: "haw" })).products.map((p) => p.id), [hawai.id]);
    assert.deepEqual((await getClientCatalogPage(tx, a.organization.id, { q: url.reference })).products.map((p) => p.id), [url.id]);
    const first = await getClientCatalogPage(tx, a.organization.id, { limit: 2 });
    assert.equal(first.products.length, 2);
    assert.ok(first.nextCursor);
    const second = await getClientCatalogPage(tx, a.organization.id, { limit: 2, cursor: first.nextCursor });
    assert.deepEqual(second.products.map((p) => p.name), ["Pom's"]);
    assert.equal(second.nextCursor, null);

    assert.deepEqual((await getClientCatalogCategories(tx, a.organization.id)).map((c) => c.name), ["Boissons A"]);
    assert.equal(await isClientCatalogProduct(tx, a.organization.id, coca.id), true);
    for (const hidden of [noPhoto, svg, inactive]) assert.equal(await isClientCatalogProduct(tx, a.organization.id, hidden.id), false);
    assert.equal(await isClientCatalogProduct(tx, a.organization.id, foreign.id), false, "other organisation");
  });
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

test("order: re-priced server-side, SUBMITTED, idempotent - and no sale, payment, stock movement, stock change or accounting entry", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRollback(async (tx) => {
    const a = await makeOrganization(tx, "A");
    const karim = await customer(tx, a, "Karim", "342115");
    const coca = await product(tx, a, "Coca-Cola", { salePrice: 4.17, depotStock: 1 });
    const poms = await product(tx, a, "Pom's", { salePrice: 3.75 });
    const scope = { organizationId: a.organization.id, customerId: karim.id, contactPhone: "0612345678" };
    const before = await businessCounts(tx);

    const expected = estimateClientCartTotal([
      { priceTTC: 5, quantity: 2 },
      { priceTTC: 4.5, quantity: 3 },
    ]).totalTTC;
    const input = {
      idempotencyKey: `k-${uid()}`,
      expectedTotalTTC: expected,
      note: "Livraison le matin",
      lines: [
        { productId: coca.id, quantity: 1 },
        { productId: poms.id, quantity: 3 },
        { productId: coca.id, quantity: 1 },
      ],
    };
    const result = await submitClientOrder(orderDeps(tx), scope, input, { ip: "1.2.3.4" });
    assert.equal(result.created, true);
    assert.equal(result.order.status, "SUBMITTED");
    assert.equal(result.order.totalTTC, 23.5);
    assert.equal(result.order.itemCount, 5);

    const stored = await tx.customerOrder.findUniqueOrThrow({ where: { id: result.order.id }, include: { lines: true } });
    assert.equal(stored.organizationId, a.organization.id);
    assert.equal(stored.customerId, karim.id);
    assert.equal(stored.contactPhone, "0612345678");
    assert.equal(stored.note, "Livraison le matin");
    assert.deepEqual(
      stored.lines.map((l) => [l.productName, l.quantity, Number(l.unitPriceHT), Number(l.totalTTC)]).sort(),
      [
        ["Coca-Cola", 2, 4.17, 10],
        ["Pom's", 3, 3.75, 13.5],
      ],
    );
    const audit = await tx.auditLog.findFirst({ where: { entityId: stored.id, action: "CLIENT_ORDER_SUBMITTED" } });
    assert.equal(audit?.ipAddress, "1.2.3.4");

    // same key again: the same order, nothing new
    const again = await submitClientOrder(orderDeps(tx), scope, input, { ip: "1.2.3.4" });
    assert.equal(again.created, false);
    assert.equal(again.order.id, result.order.id);
    assert.equal(await tx.customerOrder.count({ where: { customerId: karim.id } }), 1);

    assert.deepEqual(await businessCounts(tx), before, "no Sale / Payment / StockMovement / AccountingEntry / stock change");
    assert.deepEqual((await listClientOrders(tx, scope)).map((o) => o.id), [result.order.id]);
  });
});

test("order: price changed, unavailable or foreign products, other customer's key and the hourly limit are refused", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRollback(async (tx) => {
    const a = await makeOrganization(tx, "A");
    const b = await makeOrganization(tx, "B");
    const karim = await customer(tx, a, "Karim", "342115");
    const autre = await customer(tx, a, "Autre", "34211", { type: "COUNTER" });
    const coca = await product(tx, a, "Coca-Cola", { salePrice: 4.17 });
    const noPhoto = await product(tx, a, "Sans photo", { imageUrl: null });
    const inactive = await product(tx, a, "Inactif", { status: "INACTIVE" });
    const foreign = await product(tx, b, "Coca-Cola B");
    const scope = { organizationId: a.organization.id, customerId: karim.id, contactPhone: null };
    const submit = (lines: Array<{ productId: string; quantity: number }>, extra: Record<string, unknown> = {}) =>
      submitClientOrder(orderDeps(tx), scope, { idempotencyKey: `k-${uid()}`, lines, ...extra }, { ip: "t" });

    await assert.rejects(submit([{ productId: coca.id, quantity: 2 }], { expectedTotalTTC: 9 }), (error: unknown) => {
      assert.ok(error instanceof ClientPortalError);
      assert.equal(error.code, "PRICE_CHANGED");
      assert.equal(error.details?.totalTTC, 10);
      assert.deepEqual(error.details?.prices, [{ productId: coca.id, priceTTC: 5 }]);
      return true;
    });
    for (const bad of [noPhoto, inactive, foreign]) {
      await assert.rejects(submit([{ productId: coca.id, quantity: 1 }, { productId: bad.id, quantity: 1 }]), (error: unknown) => {
        assert.ok(error instanceof ClientPortalError);
        assert.equal(error.code, "PRODUCTS_UNAVAILABLE");
        assert.deepEqual(error.details?.productIds, [bad.id]);
        return true;
      });
    }
    await assert.rejects(submit([{ productId: coca.id, quantity: 1 }], { unitPriceHT: 0.01 }), (error: unknown) => {
      assert.ok(error instanceof ClientPortalError && error.code === "INVALID_ORDER");
      return true;
    });

    // an idempotency key already used by ANOTHER customer is never handed over
    const key = `shared-${uid()}`;
    await submitClientOrder(orderDeps(tx), { ...scope, customerId: autre.id }, { idempotencyKey: key, lines: [{ productId: coca.id, quantity: 1 }] }, { ip: "t" });
    await assert.rejects(submit([{ productId: coca.id, quantity: 1 }], { idempotencyKey: key }), (error: unknown) => {
      assert.ok(error instanceof ClientPortalError && error.code === "IDEMPOTENCY_CONFLICT");
      return true;
    });

    for (let i = 0; i < CLIENT_ORDER_MAX_PER_HOUR; i += 1) await submit([{ productId: coca.id, quantity: 1 }]);
    await assert.rejects(submit([{ productId: coca.id, quantity: 1 }]), (error: unknown) => {
      assert.ok(error instanceof ClientPortalError && error.code === "TOO_MANY_ORDERS" && error.status === 429);
      return true;
    });
    assert.equal(await tx.customerOrder.count({ where: { organizationId: b.organization.id } }), 0);
  });
});

// ---------------------------------------------------------------------------
// Staff workflow + conversion
// ---------------------------------------------------------------------------

test("staff: accept / reject guarded by status and organisation; POS only for ACCEPTED; conversion links exactly once", async (t) => {
  if (!reachable) return t.skip("database unreachable");
  await inRollback(async (tx) => {
    const a = await makeOrganization(tx, "A");
    const b = await makeOrganization(tx, "B");
    const karim = await customer(tx, a, "Karim", "342115");
    const other = await customer(tx, a, "Autre", "34211", { type: "COUNTER" });
    const coca = await product(tx, a, "Coca-Cola");
    const scope = { organizationId: a.organization.id, customerId: karim.id, contactPhone: null };
    const order = (await submitClientOrder(orderDeps(tx), scope, { idempotencyKey: `k-${uid()}`, lines: [{ productId: coca.id, quantity: 2 }] }, { ip: "t" })).order;
    const staffA = { organizationId: a.organization.id, userId: a.user.id };

    // organisation isolation
    await assert.rejects(
      transitionCustomerOrderCore(tx, { organizationId: b.organization.id, userId: b.user.id }, order.id, "ACCEPTED"),
      (error: unknown) => error instanceof CustomerOrderError && error.status === 404,
    );
    assert.equal((await listCustomerOrdersCore(tx, b.organization.id)).items.length, 0);

    // not openable in the POS before acceptance
    await assert.rejects(getCustomerOrderForPosCore(tx, a.organization.id, order.id), (error: unknown) => error instanceof CustomerOrderError && error.status === 409);

    const accepted = await transitionCustomerOrderCore(tx, staffA, order.id, "ACCEPTED");
    assert.equal(accepted.status, "ACCEPTED");
    assert.equal(accepted.processedByName, "Staff A");
    await assert.rejects(transitionCustomerOrderCore(tx, staffA, order.id, "ACCEPTED"), (error: unknown) => error instanceof CustomerOrderError && error.status === 409);
    const forPos = await getCustomerOrderForPosCore(tx, a.organization.id, order.id);
    assert.deepEqual(forPos.lines.map((l) => [l.productId, l.quantity]), [[coca.id, 2]]);

    // a minimal real sale row to link to (as createCounterSale would have just created)
    const sale = await tx.sale.create({
      data: {
        organizationId: a.organization.id,
        invoiceNumber: `T-${uid()}`,
        origin: "COUNTER",
        status: "PAID",
        customerId: karim.id,
        stockLocationId: a.depotLocation.id,
        subtotalHT: 8.34,
        taxAmount: 1.66,
        totalTTC: 10,
        paymentMethod: "CASH",
        createdByUserId: a.user.id,
      },
    });
    assert.deepEqual(
      await linkCustomerOrderToSale(tx, { organizationId: a.organization.id, customerOrderId: order.id, saleId: sale.id, saleCustomerId: other.id, userId: a.user.id }),
      { ok: false, reason: "CUSTOMER_MISMATCH" },
    );
    assert.deepEqual(
      await linkCustomerOrderToSale(tx, { organizationId: b.organization.id, customerOrderId: order.id, saleId: sale.id, saleCustomerId: karim.id, userId: a.user.id }),
      { ok: false, reason: "NOT_FOUND" },
    );
    assert.deepEqual(
      await linkCustomerOrderToSale(tx, { organizationId: a.organization.id, customerOrderId: order.id, saleId: sale.id, saleCustomerId: karim.id, userId: a.user.id }),
      { ok: true },
    );
    const converted = await tx.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(converted.status, "CONVERTED");
    assert.equal(converted.convertedSaleId, sale.id);
    assert.ok(converted.convertedAt);
    // the conversion is audited (previous status, new status, sale, acting user) - and only the one successful link
    const convertedAudits = await tx.auditLog.findMany({ where: { entityType: "CustomerOrder", entityId: order.id, action: "CUSTOMER_ORDER_CONVERTED" } });
    assert.equal(convertedAudits.length, 1);
    assert.equal(convertedAudits[0].userId, a.user.id);
    assert.equal(convertedAudits[0].organizationId, a.organization.id);
    assert.deepEqual(convertedAudits[0].oldValue, { status: "ACCEPTED" });
    assert.equal((convertedAudits[0].newValue as { status: string; saleId: string }).status, "CONVERTED");
    assert.equal((convertedAudits[0].newValue as { saleId: string }).saleId, sale.id);
    // never twice, and a converted order can no longer be rejected or opened
    assert.deepEqual(
      await linkCustomerOrderToSale(tx, { organizationId: a.organization.id, customerOrderId: order.id, saleId: sale.id, saleCustomerId: karim.id, userId: a.user.id }),
      { ok: false, reason: "ALREADY_CONVERTED" },
    );
    await assert.rejects(transitionCustomerOrderCore(tx, staffA, order.id, "REJECTED"), (error: unknown) => error instanceof CustomerOrderError && error.status === 409);
    await assert.rejects(getCustomerOrderForPosCore(tx, a.organization.id, order.id), (error: unknown) => error instanceof CustomerOrderError);

    // rejection with a reason; a rejected order is never linkable
    const second = (await submitClientOrder(orderDeps(tx), scope, { idempotencyKey: `k-${uid()}`, lines: [{ productId: coca.id, quantity: 1 }] }, { ip: "t" })).order;
    const rejected = await transitionCustomerOrderCore(tx, staffA, second.id, "REJECTED", { reason: "Hors zone de livraison" });
    assert.equal(rejected.rejectionReason, "Hors zone de livraison");
    assert.deepEqual(
      await linkCustomerOrderToSale(tx, { organizationId: a.organization.id, customerOrderId: second.id, saleId: sale.id, saleCustomerId: karim.id, userId: a.user.id }),
      { ok: false, reason: "NOT_ACCEPTED" },
    );
  });
});
