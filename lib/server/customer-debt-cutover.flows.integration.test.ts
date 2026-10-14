import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Lot 2 - the debt rule inside the REAL business flows that read the customer's debt:
 * a customer settlement (cannot exceed the debt), the credit ceiling of a counter sale,
 * the cancellation of a sale and the revision of a sale (neither may leave the customer
 * in credit). The real server code runs against a THROWAWAY PostgreSQL database; the
 * session comes from a real Session row (Bearer token) and only `next/headers` is replaced.
 *
 * The shared cutover constant stays null in the code. Here the module's `resolveCutover`
 * is replaced so that the flows see an ARBITRARY test cutover (`mockCutover`, switchable
 * per test: a Date = active, null = dormant) - exactly the value path production would use.
 *
 * Safety: the file does nothing unless D2_TEST_DATABASE_URL names the local database
 * `commdis_d2_test` AND DATABASE_URL is that very URL, and node's module mocks are on
 * (`--experimental-test-module-mocks`, passed through by the wrapper).
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
let mockCutover: Date | null = null;
let settlements: typeof import("@/lib/server/customer-settlements");
let counter: typeof import("@/lib/server/counter-sales");
let saleAdmin: typeof import("@/lib/server/sale-admin");

before(async () => {
  if (SKIP) return;
  mock.module("next/headers", {
    namedExports: {
      headers: async () => new Headers(currentToken ? { authorization: `Bearer ${currentToken}` } : {}),
      cookies: async () => ({ get: () => undefined, set: () => undefined }),
    },
  });
  // The rule module with ONE change: the shared cutover a caller gets when it passes none.
  const realRule = await import("../credit-note-debt-rule");
  mock.module("../credit-note-debt-rule", {
    namedExports: {
      ...realRule,
      resolveCutover: (option?: { cutover?: Date | null }) => (option?.cutover === undefined ? mockCutover : option.cutover),
    },
  });
  prisma = (await import("@/lib/prisma")).prisma;
  settlements = await import("@/lib/server/customer-settlements");
  counter = await import("@/lib/server/counter-sales");
  saleAdmin = await import("@/lib/server/sale-admin");
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (!SKIP) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);
const DAY = 86_400_000;
// "now - 1 hour" is the test cutover: a note validated now is AFTER it, one validated 2 days ago is BEFORE it.
const NEW = () => new Date(Date.now() - 60_000);
const OLD = () => new Date(Date.now() - 2 * DAY);
const activate = () => {
  mockCutover = new Date(Date.now() - 3_600_000);
};
const dormant = () => {
  mockCutover = null;
};

// ---- fixtures ---------------------------------------------------------------------------------------------

async function makeOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `FLW-${label}-${suffix}`.toUpperCase(), name: `Flows ${label}` } });
  const depotRow = await prisma.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot principal", address: "-", city: "-" } });
  const location = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot principal", type: "DEPOT", depotId: depotRow.id } });
  const tokens: Record<"admin" | "cashier", string> = { admin: "", cashier: "" };
  const userIds: Record<"admin" | "cashier", string> = { admin: "", cashier: "" };
  for (const role of ["admin", "cashier"] as const) {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        firstName: role,
        lastName: label,
        fullName: `${role} ${label}`,
        email: `flw-${role}-${suffix}@example.invalid`,
        passwordHash: "x",
        role: role === "admin" ? "ADMIN" : "CASHIER",
        depotId: depotRow.id,
      },
    });
    const token = `tok-${role}-${suffix}-${randomUUID()}`;
    await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    tokens[role] = token;
    userIds[role] = user.id;
  }
  const category = await prisma.category.create({ data: { organizationId: organization.id, name: "Boissons" } });
  const product = await prisma.product.create({
    data: { organizationId: organization.id, reference: `P-${suffix}`, name: "Sidi Ali 2 L", categoryId: category.id, purchasePrice: 12.5, salePrice: 100, taxRate: 20, unit: "unite" },
  });
  await prisma.stockLevel.create({ data: { organizationId: organization.id, productId: product.id, locationId: location.id, quantity: 100, reservedQuantity: 0 } });
  return { id: organization.id, tokens, userIds, locationId: location.id, productId: product.id };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

async function customer(org: Org, name: string, creditLimit?: number) {
  const row = await prisma.customer.create({
    data: {
      organizationId: org.id, code: `C-${uid()}`, name, address: "-", city: "-", type: "GROCERY", createdByUserId: org.userIds.admin, creationOrigin: "ADMIN",
      ...(creditLimit ? { creditLimitEnabled: true, creditLimit } : {}),
    },
  });
  return row.id;
}

/** A credit sale of `units` x (100 HT + 20 % VAT = 120 TTC), with its lines - what cancel / revise read. */
async function creditSale(org: Org, customerId: string, units: number) {
  const totalTTC = units * 120;
  return prisma.sale.create({
    data: {
      organizationId: org.id,
      invoiceNumber: `INV-${uid()}`,
      origin: "COUNTER",
      status: "CREDIT",
      stockLocationId: org.locationId,
      depotId: (await prisma.stockLocation.findUniqueOrThrow({ where: { id: org.locationId } })).depotId,
      customerId,
      subtotalHT: units * 100,
      taxAmount: units * 20,
      totalTTC,
      paidAmount: 0,
      creditAmount: totalTTC,
      paymentMethod: "CREDIT",
      createdByUserId: org.userIds.admin,
      validatedAt: new Date(Date.now() - 5 * DAY),
      soldAt: new Date(Date.now() - 5 * DAY),
      lines: { create: [{ productId: org.productId, quantity: units, unitPriceHT: 100, unitCostHT: 12.5, taxRate: 20, taxAmount: units * 20, totalHT: units * 100, totalTTC }] },
    },
  });
}

async function note(org: Org, customerId: string, refund: "CASH" | "BANK", total: number, validatedAt: Date) {
  return prisma.creditNote.create({
    data: {
      organizationId: org.id, creditNoteNumber: `AVC-${uid()}`, partyType: "CUSTOMER", customerId, status: "VALIDATED", origin: "MANUAL", refundMethod: refund,
      reason: "OTHER", subtotalHT: total, taxAmount: 0, totalTTC: total, createdByUserId: org.userIds.admin, validatedAt,
    },
  });
}

async function rejectsWith(promise: Promise<unknown>, status: number, message?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    const failure = error as { status?: number; message?: string };
    assert.equal(failure.status, status, `status ${failure.status}: ${failure.message}`);
    if (message) assert.match(failure.message ?? "", message);
    return true;
  });
}

const as = (org: Org, role: "admin" | "cashier") => {
  currentToken = org.tokens[role];
};

// ---- 1. customer settlements: cannot exceed the debt ------------------------------------------------------------------

test("SETTLEMENT: 500 owed, 100 refunded in cash AFTER the cutover - a settlement of 500 is accepted (the debt is 500); under the historical rule it is refused (the debt is 400)", { skip: SKIP }, async () => {
  const org = await makeOrg("settle");
  as(org, "cashier");

  activate();
  const a = await customer(org, "Apres - espèces");
  await prisma.sale.create({ data: { organizationId: org.id, invoiceNumber: `INV-${uid()}`, origin: "COUNTER", status: "CREDIT", stockLocationId: org.locationId, customerId: a, subtotalHT: 500, taxAmount: 0, totalTTC: 500, paidAmount: 0, creditAmount: 500, paymentMethod: "CREDIT", createdByUserId: org.userIds.admin, validatedAt: new Date(Date.now() - 5 * DAY), soldAt: new Date(Date.now() - 5 * DAY) } });
  await note(org, a, "CASH", 100, NEW());
  assert.equal((await settlements.getCustomerDebt(a)).debt, 500);
  const paid = await settlements.recordCustomerSettlement(a, { amount: 500, method: "CASH" });
  assert.equal(paid.amount, 500);
  assert.equal((await settlements.getCustomerDebt(a)).debt, 0);
  await rejectsWith(settlements.recordCustomerSettlement(a, { amount: 1, method: "CASH" }), 422, /aucune creance/);

  // the same data under the historical rule (dormant): the debt is 400, 500 is over it
  dormant();
  const b = await customer(org, "Dormant - espèces");
  await prisma.sale.create({ data: { organizationId: org.id, invoiceNumber: `INV-${uid()}`, origin: "COUNTER", status: "CREDIT", stockLocationId: org.locationId, customerId: b, subtotalHT: 500, taxAmount: 0, totalTTC: 500, paidAmount: 0, creditAmount: 500, paymentMethod: "CREDIT", createdByUserId: org.userIds.admin, validatedAt: new Date(Date.now() - 5 * DAY), soldAt: new Date(Date.now() - 5 * DAY) } });
  await note(org, b, "CASH", 100, NEW());
  await rejectsWith(settlements.recordCustomerSettlement(b, { amount: 500, method: "CASH" }), 422, /depasse le solde/);
  assert.equal((await settlements.recordCustomerSettlement(b, { amount: 400, method: "CASH" })).amount, 400);
});

test("SETTLEMENT: an account credit after the cutover and a cash refund BEFORE it both lower the debt (settlement ceiling 400); a cash refund after does not", { skip: SKIP }, async () => {
  const org = await makeOrg("settle2");
  as(org, "admin");
  activate();
  const sale = (customerId: string) =>
    prisma.sale.create({ data: { organizationId: org.id, invoiceNumber: `INV-${uid()}`, origin: "COUNTER", status: "CREDIT", stockLocationId: org.locationId, customerId, subtotalHT: 500, taxAmount: 0, totalTTC: 500, paidAmount: 0, creditAmount: 500, paymentMethod: "CREDIT", createdByUserId: org.userIds.admin, validatedAt: new Date(Date.now() - 5 * DAY), soldAt: new Date(Date.now() - 5 * DAY) } });
  const cases: Array<[string, "CASH" | "BANK", Date, number]> = [
    ["account credit after", "BANK", NEW(), 400],
    ["cash refund before (historical)", "CASH", OLD(), 400],
    ["cash refund after", "CASH", NEW(), 500],
  ];
  for (const [label, refund, when, ceiling] of cases) {
    const c = await customer(org, label);
    await sale(c);
    await note(org, c, refund, 100, when);
    assert.equal((await settlements.getCustomerDebt(c)).debt, ceiling, label);
    if (ceiling < 500) await rejectsWith(settlements.recordCustomerSettlement(c, { amount: ceiling + 1, method: "CASH" }), 422, /depasse le solde/);
    assert.equal((await settlements.recordCustomerSettlement(c, { amount: ceiling, method: "CASH" })).amount, ceiling, label);
  }
});

// ---- 2. the credit ceiling of a counter sale ------------------------------------------------------------------------------

test("CREDIT CEILING: limit 600, debt 500 after a 100 cash refund validated AFTER the cutover - a 120 credit sale is refused (620 > 600); historically (debt 400) it passes; an account credit or an old cash refund lets it pass", { skip: SKIP }, async () => {
  const org = await makeOrg("limit");
  as(org, "cashier");
  const attempt = (customerId: string) => counter.createCounterSale({ customerId, paymentMethod: "CREDIT", lines: [{ productId: org.productId, quantity: 1 }] } as never);

  activate();
  const refused = await customer(org, "Plafond - espèces apres", 600);
  await prisma.sale.create({ data: { organizationId: org.id, invoiceNumber: `INV-${uid()}`, origin: "COUNTER", status: "CREDIT", stockLocationId: org.locationId, customerId: refused, subtotalHT: 500, taxAmount: 0, totalTTC: 500, paidAmount: 0, creditAmount: 500, paymentMethod: "CREDIT", createdByUserId: org.userIds.admin, validatedAt: new Date(Date.now() - 5 * DAY), soldAt: new Date(Date.now() - 5 * DAY) } });
  await note(org, refused, "CASH", 100, NEW());
  await rejectsWith(attempt(refused), 409, /Plafond de credit depasse/);

  for (const [label, refund, when] of [["account credit after", "BANK", NEW()], ["cash refund before", "CASH", OLD()]] as const) {
    const c = await customer(org, label, 600);
    await prisma.sale.create({ data: { organizationId: org.id, invoiceNumber: `INV-${uid()}`, origin: "COUNTER", status: "CREDIT", stockLocationId: org.locationId, customerId: c, subtotalHT: 500, taxAmount: 0, totalTTC: 500, paidAmount: 0, creditAmount: 500, paymentMethod: "CREDIT", createdByUserId: org.userIds.admin, validatedAt: new Date(Date.now() - 5 * DAY), soldAt: new Date(Date.now() - 5 * DAY) } });
    await note(org, c, refund, 100, when);
    const sale = await attempt(c);
    assert.equal(sale.status, "CREDIT", `${label}: accepted (debt 400 + 120 = 520)`);
  }

  dormant();
  const historical = await customer(org, "Plafond - dormant", 600);
  await prisma.sale.create({ data: { organizationId: org.id, invoiceNumber: `INV-${uid()}`, origin: "COUNTER", status: "CREDIT", stockLocationId: org.locationId, customerId: historical, subtotalHT: 500, taxAmount: 0, totalTTC: 500, paidAmount: 0, creditAmount: 500, paymentMethod: "CREDIT", createdByUserId: org.userIds.admin, validatedAt: new Date(Date.now() - 5 * DAY), soldAt: new Date(Date.now() - 5 * DAY) } });
  await note(org, historical, "CASH", 100, NEW());
  assert.equal((await attempt(historical)).status, "CREDIT", "dormant: the cash refund counts (400 + 120 = 520), as today");
});

// ---- 3. cancelling a sale ----------------------------------------------------------------------------------------------------

test("CANCELLATION of a credit sale (must not leave the customer in credit): refused when the notes that reduce the debt cover it, allowed when they do not", { skip: SKIP }, async () => {
  const org = await makeOrg("cancel");
  as(org, "admin");
  const run = async (label: string, refund: "CASH" | "BANK", when: Date, active: boolean, expectCancelled: boolean) => {
    if (active) activate(); else dormant();
    const c = await customer(org, label);
    const sale = await creditSale(org, c, 3); // 360
    await note(org, c, refund, 100, when);
    if (expectCancelled) {
      const cancelled = await saleAdmin.cancelSale(sale.id, {});
      assert.equal(cancelled.status, "CANCELLED", label);
    } else {
      await rejectsWith(saleAdmin.cancelSale(sale.id, {}), 409, /rendrait le solde du client crediteur/);
      assert.equal((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status, "CREDIT", `${label}: untouched`);
    }
  };
  await run("cash after, active", "CASH", NEW(), true, true); // the refund does not reduce the debt: cancelling leaves 0
  await run("account credit after, active", "BANK", NEW(), true, false);
  await run("cash BEFORE (historical), active", "CASH", OLD(), true, false);
  await run("cash now, dormant", "CASH", NEW(), false, false); // the historical rule: as before
});

// ---- 4. revising a sale ------------------------------------------------------------------------------------------------------

test("REVISION of a credit sale (must not leave the customer in credit): the same rule decides", { skip: SKIP }, async () => {
  const org = await makeOrg("revise");
  as(org, "admin");
  const revise = (saleId: string, customerId: string) =>
    saleAdmin.reviseSale(saleId, { customerId, paymentMethod: "CREDIT", lines: [{ productId: org.productId, quantity: 1 }] }); // 2 units (240) -> 1 unit (120)
  const run = async (label: string, refund: "CASH" | "BANK", when: Date, active: boolean, expectRevised: boolean) => {
    if (active) activate(); else dormant();
    const c = await customer(org, label);
    const sale = await creditSale(org, c, 2); // 240
    await note(org, c, refund, 200, when);
    if (expectRevised) {
      const revised = await revise(sale.id, c);
      assert.ok(revised, label);
      assert.equal((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).creditAmount.toNumber(), 120, `${label}: revised to 1 unit`);
    } else {
      await rejectsWith(revise(sale.id, c), 409, /rendrait le solde du client crediteur/);
      assert.equal((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).creditAmount.toNumber(), 240, `${label}: untouched`);
    }
  };
  await run("cash 200 after, active", "CASH", NEW(), true, true); // raw 240 -> 120: fine
  await run("account credit 200 after, active", "BANK", NEW(), true, false); // raw 40 -> -80: refused
  await run("cash 200 before, active", "CASH", OLD(), true, false);
  await run("cash 200 now, dormant", "CASH", NEW(), false, false);
});
