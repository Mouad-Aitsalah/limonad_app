import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { CreateDriverReturnInput } from "@/types/credit-note";

/**
 * Goods returns are CLOSED to drivers (lib/driver-returns-policy.ts). The REAL route
 * handlers, the REAL session lookup (a Session row sent as a Bearer token), the REAL
 * module guard and the REAL credit-note code, against a THROWAWAY PostgreSQL database.
 * Only `next/headers` is replaced (no Next request scope in a test).
 *
 * Every refusal below is proven with ALL the conditions of a real driver return met -
 * an active driver, a truck assigned, a tour IN_PROGRESS, a customer and a valid sale
 * line - so the 403 can only come from the closing itself, never from a missing datum.
 *
 * Safety: the file does nothing unless D2_TEST_DATABASE_URL names the local database
 * `commdis_d2_test` AND DATABASE_URL is that very URL, and node's module mocks are on
 * (run it with `--experimental-test-module-mocks`; the wrapper passes it through).
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

const ORIGIN = "https://app.test";
const DISABLED_MESSAGE = "Le retour de marchandises n'est pas disponible pour les chauffeurs.";

type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
type Routes = {
  driverReturns: { POST: Handler };
  returnables: { GET: Handler };
  list: { GET: Handler; POST: Handler };
  manual: { POST: Handler };
  draft: { POST: Handler };
  detail: { GET: Handler };
  validate: { POST: Handler };
  reverse: { POST: Handler };
};

let prisma: PrismaClient;
let routes: Routes;
let createDriverReturn: typeof import("@/lib/server/credit-notes").createDriverReturn;
let currentToken: string | null = null;

before(async () => {
  if (SKIP) return;
  mock.module("next/headers", {
    namedExports: {
      headers: async () => new Headers(currentToken ? { authorization: `Bearer ${currentToken}` } : {}),
      cookies: async () => ({ get: () => undefined, set: () => undefined }),
    },
  });
  prisma = (await import("@/lib/prisma")).prisma;
  createDriverReturn = (await import("@/lib/server/credit-notes")).createDriverReturn;
  routes = {
    driverReturns: (await import("@/app/api/driver/returns/route")) as Routes["driverReturns"],
    returnables: (await import("@/app/api/credit-notes/returnables/route")) as Routes["returnables"],
    list: (await import("@/app/api/credit-notes/route")) as Routes["list"],
    manual: (await import("@/app/api/credit-notes/manual/route")) as Routes["manual"],
    draft: (await import("@/app/api/credit-notes/draft/route")) as Routes["draft"],
    detail: (await import("@/app/api/credit-notes/[id]/route")) as Routes["detail"],
    validate: (await import("@/app/api/credit-notes/[id]/validate/route")) as Routes["validate"],
    reverse: (await import("@/app/api/credit-notes/[id]/reverse/route")) as Routes["reverse"],
  };
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (!SKIP) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);

// ---- fixtures: a complete driver situation ----------------------------------------------------------------

type Role = "admin" | "depot_manager" | "cashier" | "driver";
const PRISMA_ROLE = { admin: "ADMIN", depot_manager: "DEPOT_MANAGER", cashier: "CASHIER", driver: "DRIVER" } as const;

async function makeDriverOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `DR-${label}-${suffix}`.toUpperCase(), name: `Driver ${label}` } });
  const tokens = {} as Record<Role, string>;
  const userIds = {} as Record<Role, string>;
  for (const role of Object.keys(PRISMA_ROLE) as Role[]) {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        firstName: role,
        lastName: label,
        fullName: `${role} ${label}`,
        email: `dr-${role}-${suffix}@example.invalid`,
        passwordHash: "x",
        role: PRISMA_ROLE[role],
      },
    });
    const token = `tok-${role}-${suffix}-${randomUUID()}`;
    await prisma.session.create({
      data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    tokens[role] = token;
    userIds[role] = user.id;
  }
  const depotRow = await prisma.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot principal", address: "-", city: "-" } });
  const depot = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot principal", type: "DEPOT", depotId: depotRow.id } });
  const truckRow = await prisma.truck.create({ data: { organizationId: organization.id, code: `T-${suffix}`, registration: `REG-${suffix}`, depotId: depotRow.id } });
  const truck = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `T-${suffix}`, name: "Camion 1", type: "TRUCK", truckId: truckRow.id } });
  const driverRow = await prisma.driver.create({
    data: { organizationId: organization.id, employeeCode: `E-${suffix}`, userId: userIds.driver, truckId: truckRow.id, active: true },
  });
  const tour = await prisma.tour.create({
    data: {
      organizationId: organization.id,
      code: `TOUR-${suffix}`,
      date: new Date(),
      depotId: depotRow.id,
      truckId: truckRow.id,
      driverId: driverRow.id,
      createdByUserId: userIds.admin,
      status: "IN_PROGRESS",
      startedAt: new Date(),
    },
  });
  const category = await prisma.category.create({ data: { organizationId: organization.id, name: "Boissons" } });
  const product = await prisma.product.create({
    data: { organizationId: organization.id, reference: `P-${suffix}`, name: "Sidi Ali 2 L", categoryId: category.id, purchasePrice: 12.5, salePrice: 100, taxRate: 20, unit: "unite" },
  });
  const customer = await prisma.customer.create({
    data: { organizationId: organization.id, code: `C-${suffix}`, name: "Client test", address: "-", city: "-", type: "GROCERY", createdByUserId: userIds.admin, creationOrigin: "ADMIN" },
  });
  // truck stock and a valid truck sale of the tour (5 x 80 HT, VAT 20 %)
  await prisma.stockLevel.create({ data: { organizationId: organization.id, productId: product.id, locationId: truck.id, quantity: 10, reservedQuantity: 0 } });
  const sale = await prisma.sale.create({
    data: {
      organizationId: organization.id,
      invoiceNumber: `INV-${uid()}`,
      origin: "TRUCK",
      status: "PAID",
      stockLocationId: truck.id,
      truckId: truckRow.id,
      driverId: driverRow.id,
      tourId: tour.id,
      customerId: customer.id,
      subtotalHT: 400,
      taxAmount: 80,
      totalTTC: 480,
      paidAmount: 480,
      paymentMethod: "CASH",
      createdByUserId: userIds.driver,
      validatedAt: new Date(),
      soldAt: new Date(),
      lines: { create: [{ productId: product.id, quantity: 5, unitPriceHT: 80, unitCostHT: 12.5, taxRate: 20, taxAmount: 80, totalHT: 400, totalTTC: 480 }] },
    },
    include: { lines: true },
  });
  return {
    id: organization.id,
    tokens,
    userIds,
    depotId: depot.id,
    truckLocationId: truck.id,
    tourId: tour.id,
    tourCode: tour.code,
    truckId: truckRow.id,
    driverId: driverRow.id,
    productId: product.id,
    customerId: customer.id,
    saleLineId: sale.lines[0].id,
    invoiceNumber: sale.invoiceNumber,
  };
}
type Org = Awaited<ReturnType<typeof makeDriverOrg>>;

const driverReturnBody = (org: Org): CreateDriverReturnInput => ({
  customerId: org.customerId,
  reason: "produit_endommage",
  comment: "Bouteilles abimees",
  lines: [{ productId: org.productId, quantityReturned: 1, saleLineId: org.saleLineId }],
  idempotencyKey: randomUUID(),
});

type CallOptions = { token: string | null; method?: "GET" | "POST"; body?: unknown; id?: string; search?: string };

async function call(handler: Handler, path: string, options: CallOptions) {
  currentToken = options.token;
  const headers: Record<string, string> = { "x-forwarded-host": "app.test", "x-forwarded-proto": "https", origin: ORIGIN };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const method = options.method ?? "POST";
  const request = new Request(`${ORIGIN}${path}${options.search ?? ""}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const response = await handler(request, options.id ? { params: Promise.resolve({ id: options.id }) } : undefined);
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, text };
}

/** Everything a goods return could write, to prove a refusal wrote nothing. */
async function writes(org: Org) {
  const stock = await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId: org.productId, locationId: org.truckLocationId } } });
  return {
    creditNotes: await prisma.creditNote.count({ where: { organizationId: org.id } }),
    creditNoteLines: await prisma.creditNoteLine.count({ where: { creditNote: { organizationId: org.id } } }),
    movements: await prisma.stockMovement.count({ where: { organizationId: org.id } }),
    entries: await prisma.accountingEntry.count({ where: { organizationId: org.id } }),
    creditNoteAudits: await prisma.auditLog.count({ where: { organizationId: org.id, entityType: "CreditNote" } }),
    truckStock: stock?.quantity ?? 0,
    depotStock: (await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId: org.productId, locationId: org.depotId } } }))?.quantity ?? 0,
  };
}

const ROLES: Array<Role | "anonymous"> = ["driver", "admin", "depot_manager", "cashier", "anonymous"];
const tokenOf = (org: Org, role: Role | "anonymous") => (role === "anonymous" ? null : org.tokens[role]);

// ---- creation: closed for every caller ------------------------------------------------------------------------

test("POST /api/driver/returns is closed (403, same message) for EVERY role - even for a complete, valid driver return; nothing is written", { skip: SKIP }, async () => {
  const org = await makeDriverOrg("create");
  const before = await writes(org);
  for (const role of ROLES) {
    const result = await call(routes.driverReturns.POST, "/api/driver/returns", { token: tokenOf(org, role), body: driverReturnBody(org) });
    assert.equal(result.status, 403, role);
    assert.equal(result.json.message, DISABLED_MESSAGE, role);
    assert.equal(result.json.creditNote, undefined, role);
  }
  assert.deepEqual(await writes(org), before, "no credit note, line, stock movement, accounting entry or audit; truck stock untouched");
  assert.equal(before.truckStock, 10);

  // the route still starts with the module check every route has: with the driver app module off, that 403 comes first
  await prisma.organization.update({ where: { id: org.id }, data: { moduleSettings: { modules: { driverApp: false } } } });
  const moduleOff = await call(routes.driverReturns.POST, "/api/driver/returns", { token: org.tokens.driver, body: driverReturnBody(org) });
  assert.equal(moduleOff.status, 403);
  assert.equal(moduleOff.json.code, "MODULE_DISABLED");
  assert.deepEqual(await writes(org), before);
});

test("createDriverReturn refuses FIRST, for any caller: a complete driver session gets 403, and so does no session at all (the guard precedes authentication)", { skip: SKIP }, async () => {
  const org = await makeDriverOrg("fn");
  const before = await writes(org);
  for (const token of [org.tokens.driver, null, org.tokens.admin]) {
    currentToken = token;
    await assert.rejects(createDriverReturn(driverReturnBody(org)), (error: unknown) => {
      const failure = error as { status?: number; message?: string };
      assert.equal(failure.status, 403);
      assert.equal(failure.message, DISABLED_MESSAGE);
      return true;
    });
  }
  assert.deepEqual(await writes(org), before);
});

// ---- reading what can be returned -----------------------------------------------------------------------------------

test("GET /api/credit-notes/returnables: the driver is refused (403) and nothing about invoices, products, quantities or prices is exposed; the desk roles keep their access", { skip: SKIP }, async () => {
  const org = await makeDriverOrg("read");
  const search = `?customerId=${encodeURIComponent(org.customerId)}`;

  const driver = await call(routes.returnables.GET, "/api/credit-notes/returnables", { token: org.tokens.driver, method: "GET", search });
  assert.equal(driver.status, 403);
  assert.deepEqual(Object.keys(driver.json), ["message"], "only a message");
  for (const secret of [org.invoiceNumber, "Sidi Ali", org.productId, org.saleLineId, "products", "unitPrice", "prices", "origins"]) {
    assert.equal(driver.text.includes(secret), false, `the refusal does not contain « ${secret} »`);
  }

  assert.equal((await call(routes.returnables.GET, "/api/credit-notes/returnables", { token: null, method: "GET", search })).status, 401);

  for (const role of ["admin", "depot_manager", "cashier"] as const) {
    const ok = await call(routes.returnables.GET, "/api/credit-notes/returnables", { token: org.tokens[role], method: "GET", search });
    assert.equal(ok.status, 200, role);
    const products = ok.json.products as Array<{ productId: string; returnableQuantity: number; origins: Array<{ invoiceNumber: string; saleLineId: string }> }>;
    assert.equal(products.length, 1, `${role}: the data is really there`);
    assert.equal(products[0].returnableQuantity, 5);
    assert.equal(products[0].origins[0].invoiceNumber, org.invoiceNumber);
  }
});

test("returnables: another organisation's customer id reveals nothing, to any role", { skip: SKIP }, async () => {
  const [a, b] = [await makeDriverOrg("own"), await makeDriverOrg("foreign")];
  const search = `?customerId=${encodeURIComponent(a.customerId)}`;
  const intruder = await call(routes.returnables.GET, "/api/credit-notes/returnables", { token: b.tokens.admin, method: "GET", search });
  assert.equal(intruder.status, 200);
  assert.deepEqual(intruder.json.products, [], "an empty list - the organisation filter holds");
  const foreignDriver = await call(routes.returnables.GET, "/api/credit-notes/returnables", { token: b.tokens.driver, method: "GET", search });
  assert.equal(foreignDriver.status, 403);
});

// ---- the driver has no access anywhere in the credit-note API -----------------------------------------------------------

test("route x role matrix: the driver (and anonymous) never get past the role check on any credit-note route", { skip: SKIP }, async () => {
  const org = await makeDriverOrg("matrix");
  const draft = await call(routes.draft.POST, "/api/credit-notes/draft", {
    token: org.tokens.admin,
    body: {
      partyType: "client", customerId: org.customerId, returnMode: "MANUAL", reason: "produit_endommage", comment: "Brouillon de test",
      returnDate: new Date().toISOString().slice(0, 10), stockDestinationLocationId: org.depotId,
      lines: [{ productId: org.productId, quantityReturned: 1 }], idempotencyKey: randomUUID(),
    },
  });
  assert.equal(draft.status, 201);
  const draftId = (draft.json.creditNote as { id: string }).id;
  const before = await writes(org);
  const body = { partyType: "client", customerId: org.customerId, returnMode: "MANUAL", reason: "produit_endommage", comment: "tentative", returnDate: "2026-10-14", stockDestinationLocationId: org.depotId, lines: [{ productId: org.productId, quantityReturned: 1 }], idempotencyKey: randomUUID() };
  const search = `?customerId=${encodeURIComponent(org.customerId)}`;
  const cells: Array<[string, () => Promise<{ status: number }>, () => Promise<{ status: number }>]> = [
    ["GET /api/credit-notes", () => call(routes.list.GET, "/api/credit-notes", { token: org.tokens.driver, method: "GET" }), () => call(routes.list.GET, "/api/credit-notes", { token: null, method: "GET" })],
    ["POST /api/credit-notes", () => call(routes.list.POST, "/api/credit-notes", { token: org.tokens.driver, body }), () => call(routes.list.POST, "/api/credit-notes", { token: null, body })],
    ["POST /manual", () => call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.driver, body }), () => call(routes.manual.POST, "/api/credit-notes/manual", { token: null, body })],
    ["POST /draft", () => call(routes.draft.POST, "/api/credit-notes/draft", { token: org.tokens.driver, body }), () => call(routes.draft.POST, "/api/credit-notes/draft", { token: null, body })],
    ["GET /[id]", () => call(routes.detail.GET, `/api/credit-notes/${draftId}`, { token: org.tokens.driver, method: "GET", id: draftId }), () => call(routes.detail.GET, `/api/credit-notes/${draftId}`, { token: null, method: "GET", id: draftId })],
    ["POST /[id]/validate", () => call(routes.validate.POST, `/api/credit-notes/${draftId}/validate`, { token: org.tokens.driver, id: draftId }), () => call(routes.validate.POST, `/api/credit-notes/${draftId}/validate`, { token: null, id: draftId })],
    ["POST /[id]/reverse", () => call(routes.reverse.POST, `/api/credit-notes/${draftId}/reverse`, { token: org.tokens.driver, id: draftId }), () => call(routes.reverse.POST, `/api/credit-notes/${draftId}/reverse`, { token: null, id: draftId })],
    ["GET /returnables", () => call(routes.returnables.GET, "/api/credit-notes/returnables", { token: org.tokens.driver, method: "GET", search }), () => call(routes.returnables.GET, "/api/credit-notes/returnables", { token: null, method: "GET", search })],
  ];
  for (const [label, asDriver, asAnonymous] of cells) {
    assert.equal((await asDriver()).status, 403, `${label} as driver`);
    assert.equal((await asAnonymous()).status, 401, `${label} anonymous`);
  }
  assert.equal((await call(routes.driverReturns.POST, "/api/driver/returns", { token: org.tokens.driver, body: driverReturnBody(org) })).status, 403);
  assert.deepEqual(await writes(org), before, "the whole matrix wrote nothing");
  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id: draftId } })).status, "DRAFT");
});

// ---- historical driver returns: kept, readable, reversible by the desk ---------------------------------------------------

test("an OLD driver return stays in the database, readable by the desk roles and reversible by admin / depot manager only (stock taken back from the truck)", { skip: SKIP }, async () => {
  const org = await makeDriverOrg("history");
  // a driver return as createDriverReturn used to record it: validated, tied to the tour, truck stock +1, one movement
  const note = await prisma.creditNote.create({
    data: {
      organizationId: org.id,
      creditNoteNumber: `AVC-OLD-${uid()}`,
      originalSaleId: (await prisma.saleLine.findUniqueOrThrow({ where: { id: org.saleLineId } })).saleId,
      partyType: "CUSTOMER",
      customerId: org.customerId,
      status: "VALIDATED",
      origin: "SALE",
      reason: "DAMAGED_PRODUCT",
      comment: "Retour enregistre avant la fermeture",
      stockDestinationLocationId: org.truckLocationId,
      subtotalHT: 80,
      taxAmount: 16,
      totalTTC: 96,
      createdByUserId: org.userIds.driver,
      validatedByUserId: org.userIds.driver,
      validatedAt: new Date(),
      driverId: org.driverId,
      truckId: org.truckId,
      tourId: org.tourId,
      lines: { create: [{ saleLineId: org.saleLineId, productId: org.productId, quantity: 1, unitPriceHT: 80, taxRate: 20, totalHT: 80, taxAmount: 16, totalTTC: 96 }] },
    },
  });
  await prisma.stockLevel.update({ where: { productId_locationId: { productId: org.productId, locationId: org.truckLocationId } }, data: { quantity: { increment: 1 } } });
  await prisma.stockMovement.create({
    data: {
      organizationId: org.id, movementNumber: `MV-OLD-${uid()}`, type: "CUSTOMER_RETURN", productId: org.productId, quantity: 1,
      destinationLocationId: org.truckLocationId, referenceType: "CREDIT_NOTE", referenceId: note.id, reason: "Avoir client ancien", createdByUserId: org.userIds.driver, status: "VALIDATED",
    },
  });
  assert.equal((await writes(org)).truckStock, 11);

  // readable by the desk roles, still carrying its tour link; not by the driver
  for (const role of ["admin", "depot_manager", "cashier"] as const) {
    const read = await call(routes.detail.GET, `/api/credit-notes/${note.id}`, { token: org.tokens[role], method: "GET", id: note.id });
    assert.equal(read.status, 200, role);
    const dto = read.json.creditNote as { status: string; driverReturnTourCode: string | null; stockDestinationLocationId: string };
    assert.equal(dto.status, "VALIDE");
    assert.equal(dto.driverReturnTourCode, org.tourCode, "the link to the tour is intact");
    assert.equal(dto.stockDestinationLocationId, org.truckLocationId);
  }
  const listed = await call(routes.list.GET, "/api/credit-notes", { token: org.tokens.admin, method: "GET" });
  assert.ok((listed.json.creditNotes as Array<{ id: string }>).some((item) => item.id === note.id), "listed for the desk");
  assert.equal((await call(routes.detail.GET, `/api/credit-notes/${note.id}`, { token: org.tokens.driver, method: "GET", id: note.id })).status, 403);

  // reversal: driver and cashier refused; depot manager reverses once
  assert.equal((await call(routes.reverse.POST, `/api/credit-notes/${note.id}/reverse`, { token: org.tokens.driver, id: note.id })).status, 403);
  assert.equal((await call(routes.reverse.POST, `/api/credit-notes/${note.id}/reverse`, { token: org.tokens.cashier, id: note.id })).status, 403);
  assert.equal((await writes(org)).truckStock, 11, "refused reversals changed nothing");
  const reversed = await call(routes.reverse.POST, `/api/credit-notes/${note.id}/reverse`, { token: org.tokens.depot_manager, id: note.id });
  assert.equal(reversed.status, 200);
  assert.equal((reversed.json.creditNote as { status: string }).status, "CONTREPASSE");
  assert.equal((await writes(org)).truckStock, 10, "the returned unit left the truck again");
  assert.equal((await call(routes.reverse.POST, `/api/credit-notes/${note.id}/reverse`, { token: org.tokens.admin, id: note.id })).status, 422, "never reversed twice");
  assert.equal((await writes(org)).truckStock, 10);
});
