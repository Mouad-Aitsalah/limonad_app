import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Lot 1 (avoirs) - HTTP and security layer. The REAL route handlers
 * (app/api/credit-notes/**), the REAL session lookup (a Session row in the database,
 * sent as a Bearer token), the REAL CSRF origin check, the REAL module guard and the
 * REAL credit-note code, against a THROWAWAY PostgreSQL database. Only `next/headers`
 * is replaced (there is no Next request scope in a test): it hands the current test
 * token to the application's own session code, exactly as a request would.
 *
 * Safety: the file does nothing unless D2_TEST_DATABASE_URL names the local database
 * `commdis_d2_test` AND DATABASE_URL is that very URL. It also needs node's module mocks:
 * run it with `--experimental-test-module-mocks` (the wrapper passes it through).
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

type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
type Routes = {
  manual: { POST: Handler };
  draft: { POST: Handler };
  generic: { GET: Handler; POST: Handler };
  detail: { GET: Handler };
  validate: { POST: Handler };
  reverse: { POST: Handler };
};

let prisma: PrismaClient;
let routes: Routes;
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
  routes = {
    manual: (await import("@/app/api/credit-notes/manual/route")) as Routes["manual"],
    draft: (await import("@/app/api/credit-notes/draft/route")) as Routes["draft"],
    generic: (await import("@/app/api/credit-notes/route")) as Routes["generic"],
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

// ---- fixtures ---------------------------------------------------------------------------------------------

type Role = "admin" | "depot_manager" | "cashier" | "driver";
const PRISMA_ROLE = { admin: "ADMIN", depot_manager: "DEPOT_MANAGER", cashier: "CASHIER", driver: "DRIVER" } as const;

async function makeOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `HT-${label}-${suffix}`.toUpperCase(), name: `Http ${label}` } });
  const tokens = {} as Record<Role, string>;
  const userIds = {} as Record<Role, string>;
  for (const role of Object.keys(PRISMA_ROLE) as Role[]) {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        firstName: role,
        lastName: label,
        fullName: `${role} ${label}`,
        email: `ht-${role}-${suffix}@example.invalid`,
        passwordHash: "x",
        role: PRISMA_ROLE[role],
      },
    });
    const token = `tok-${role}-${suffix}-${randomUUID()}`;
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    tokens[role] = token;
    userIds[role] = user.id;
  }
  const depotRow = await prisma.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot principal", address: "-", city: "-" } });
  const depot = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot principal", type: "DEPOT", depotId: depotRow.id } });
  const category = await prisma.category.create({ data: { organizationId: organization.id, name: "Boissons" } });
  const product = await prisma.product.create({
    data: { organizationId: organization.id, reference: `P-${suffix}`, name: "Sidi Ali 2 L", categoryId: category.id, purchasePrice: 12.5, salePrice: 100, taxRate: 20, unit: "unite" },
  });
  const makeCustomer = (code: string) =>
    prisma.customer.create({
      data: { organizationId: organization.id, code: `${code}-${suffix}`, name: `Client ${code}`, address: "-", city: "-", type: "GROCERY", createdByUserId: userIds.admin, creationOrigin: "ADMIN" },
    });
  const customer = await makeCustomer("C1");
  const otherCustomer = await makeCustomer("C2");
  return { id: organization.id, tokens, userIds, depotId: depot.id, productId: product.id, customerId: customer.id, otherCustomerId: otherCustomer.id };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

function noteBody(org: Org, over: Record<string, unknown> = {}) {
  return {
    partyType: "client",
    customerId: org.customerId,
    returnMode: "MANUAL",
    reason: "produit_endommage",
    comment: "Bouteilles abimees a la livraison",
    returnDate: new Date().toISOString().slice(0, 10),
    stockDestinationLocationId: org.depotId,
    lines: [{ productId: org.productId, quantityReturned: 3 }],
    idempotencyKey: randomUUID(),
    ...over,
  };
}

type CallOptions = { token: string | null; method?: "GET" | "POST"; body?: unknown; origin?: string | null; id?: string };

async function call(handler: Handler, path: string, options: CallOptions) {
  currentToken = options.token;
  const headers: Record<string, string> = { "x-forwarded-host": "app.test", "x-forwarded-proto": "https" };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const method = options.method ?? "POST";
  const request = new Request(`${ORIGIN}${path}`, {
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
  return { status: response.status, json };
}

const stockOf = async (productId: string, locationId: string) =>
  (await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity ?? 0;

const createdNotes = (orgId: string) => prisma.creditNote.count({ where: { organizationId: orgId } });
const noteIdOf = (json: Record<string, unknown>) => (json.creditNote as { id: string }).id;

// ---- authentication, CSRF, module ------------------------------------------------------------------------------

test("no session: every credit-note route refuses (401) and nothing is written", { skip: SKIP }, async () => {
  const org = await makeOrg("anon");
  for (const [handler, path] of [
    [routes.manual.POST, "/api/credit-notes/manual"],
    [routes.draft.POST, "/api/credit-notes/draft"],
    [routes.generic.POST, "/api/credit-notes"],
  ] as const) {
    const result = await call(handler, path, { token: null, body: noteBody(org) });
    assert.equal(result.status, 401, path);
  }
  assert.equal((await call(routes.generic.GET, "/api/credit-notes", { token: null, method: "GET" })).status, 401);
  assert.equal((await call(routes.validate.POST, "/api/credit-notes/x/validate", { token: null, id: "x" })).status, 401);
  assert.equal((await call(routes.reverse.POST, "/api/credit-notes/x/reverse", { token: null, id: "x" })).status, 401);
  assert.equal(await createdNotes(org.id), 0);
});

test("an expired or revoked session is refused like no session", { skip: SKIP }, async () => {
  const org = await makeOrg("expired");
  await prisma.session.updateMany({ where: { userId: org.userIds.cashier }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body: noteBody(org) })).status, 401);
  await prisma.session.updateMany({ where: { userId: org.userIds.admin }, data: { revokedAt: new Date() } });
  assert.equal((await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.admin, body: noteBody(org) })).status, 401);
  assert.equal(await createdNotes(org.id), 0);
});

test("CSRF: a mutating request with a missing or foreign origin is refused (403) even with a valid session", { skip: SKIP }, async () => {
  const org = await makeOrg("csrf");
  const missing = await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.admin, body: noteBody(org), origin: null });
  assert.equal(missing.status, 403);
  assert.match(String(missing.json.message), /origine manquante/);
  const foreign = await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.admin, body: noteBody(org), origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
  assert.match(String(foreign.json.message), /origine non autorisee/);
  assert.equal(await createdNotes(org.id), 0);
  assert.equal(await stockOf(org.productId, org.depotId), 0);
});

test("a disabled « creditNotes » module refuses the routes (403 MODULE_DISABLED)", { skip: SKIP }, async () => {
  const org = await makeOrg("module");
  await prisma.organization.update({ where: { id: org.id }, data: { moduleSettings: { modules: { creditNotes: false } } } });
  const result = await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.admin, body: noteBody(org) });
  assert.equal(result.status, 403);
  assert.equal(result.json.code, "MODULE_DISABLED");
  assert.equal(await createdNotes(org.id), 0);
});

// ---- roles ------------------------------------------------------------------------------------------------------------

test("HTTP: the cashier creates a customer note (201, depot credited); the idempotent resubmission returns the same note", { skip: SKIP }, async () => {
  const org = await makeOrg("cashier");
  const body = noteBody(org, { lines: [{ productId: org.productId, quantityReturned: 3, unitPrice: 1, discountPercent: 90 }] });
  const first = await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body });
  assert.equal(first.status, 201);
  const note = first.json.creditNote as { status: string; totalTTC: number; refundMode: string };
  assert.equal(note.status, "VALIDE");
  assert.equal(note.refundMode, "remboursement_especes");
  assert.equal(note.totalTTC, 360, "price locked to the catalogue over HTTP too");

  const again = await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body });
  assert.equal(again.status, 201);
  assert.equal(noteIdOf(again.json), noteIdOf(first.json));
  assert.equal(await createdNotes(org.id), 1);
  assert.equal(await stockOf(org.productId, org.depotId), 3, "credited once");
});

test("HTTP: a request without the submission key is refused (422)", { skip: SKIP }, async () => {
  const org = await makeOrg("nokey");
  const result = await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body: noteBody(org, { idempotencyKey: undefined }) });
  assert.equal(result.status, 422);
  assert.match(String(result.json.message), /Identifiant de soumission/);
  assert.equal(await createdNotes(org.id), 0);
});

test("the driver role is refused (403) on create, draft, list, detail, validate and reverse; the draft stays a draft", { skip: SKIP }, async () => {
  const org = await makeOrg("driver");
  const draft = await call(routes.draft.POST, "/api/credit-notes/draft", { token: org.tokens.admin, body: noteBody(org) });
  assert.equal(draft.status, 201);
  const draftId = noteIdOf(draft.json);
  const done = await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.admin, body: noteBody(org) });
  const doneId = noteIdOf(done.json);

  const driver = org.tokens.driver;
  assert.equal((await call(routes.manual.POST, "/api/credit-notes/manual", { token: driver, body: noteBody(org) })).status, 403);
  assert.equal((await call(routes.draft.POST, "/api/credit-notes/draft", { token: driver, body: noteBody(org) })).status, 403);
  assert.equal((await call(routes.generic.POST, "/api/credit-notes", { token: driver, body: noteBody(org) })).status, 403);
  assert.equal((await call(routes.generic.GET, "/api/credit-notes", { token: driver, method: "GET" })).status, 403);
  assert.equal((await call(routes.detail.GET, `/api/credit-notes/${doneId}`, { token: driver, method: "GET", id: doneId })).status, 403);
  assert.equal((await call(routes.validate.POST, `/api/credit-notes/${draftId}/validate`, { token: driver, id: draftId })).status, 403);
  assert.equal((await call(routes.reverse.POST, `/api/credit-notes/${doneId}/reverse`, { token: driver, id: doneId })).status, 403);

  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id: draftId } })).status, "DRAFT");
  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id: doneId } })).status, "VALIDATED");
  assert.equal(await createdNotes(org.id), 2, "the driver created nothing");
  assert.equal(await stockOf(org.productId, org.depotId), 3, "no stock moved by the refused calls");
});

test("reversal over HTTP: the cashier is refused (403); admin and depot manager reverse once (a second call is 422)", { skip: SKIP }, async () => {
  const org = await makeOrg("reverse");
  const made = await call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body: noteBody(org) });
  const id = noteIdOf(made.json);
  assert.equal((await call(routes.reverse.POST, `/api/credit-notes/${id}/reverse`, { token: org.tokens.cashier, id })).status, 403);
  assert.equal(await stockOf(org.productId, org.depotId), 3);

  const reversed = await call(routes.reverse.POST, `/api/credit-notes/${id}/reverse`, { token: org.tokens.depot_manager, id });
  assert.equal(reversed.status, 200);
  assert.equal((reversed.json.creditNote as { status: string }).status, "CONTREPASSE");
  assert.equal(await stockOf(org.productId, org.depotId), 0);
  const twice = await call(routes.reverse.POST, `/api/credit-notes/${id}/reverse`, { token: org.tokens.admin, id });
  assert.equal(twice.status, 422);
  assert.equal(await stockOf(org.productId, org.depotId), 0, "never reversed twice");
});

test("validation over HTTP: a cashier validates a draft once; the second validation is refused (422)", { skip: SKIP }, async () => {
  const org = await makeOrg("validate");
  const draft = await call(routes.draft.POST, "/api/credit-notes/draft", { token: org.tokens.cashier, body: noteBody(org) });
  const id = noteIdOf(draft.json);
  assert.equal(await stockOf(org.productId, org.depotId), 0);
  const first = await call(routes.validate.POST, `/api/credit-notes/${id}/validate`, { token: org.tokens.cashier, id });
  assert.equal(first.status, 200);
  const second = await call(routes.validate.POST, `/api/credit-notes/${id}/validate`, { token: org.tokens.cashier, id });
  assert.equal(second.status, 422);
  assert.equal(await stockOf(org.productId, org.depotId), 3, "credited once");
});

// ---- isolation between organisations --------------------------------------------------------------------------------------

test("organisation isolation: another organisation can neither read, validate, reverse nor list a note (404), and its data is untouched", { skip: SKIP }, async () => {
  const [a, b] = [await makeOrg("alpha"), await makeOrg("beta")];
  const draft = await call(routes.draft.POST, "/api/credit-notes/draft", { token: a.tokens.admin, body: noteBody(a) });
  const draftId = noteIdOf(draft.json);
  const done = await call(routes.manual.POST, "/api/credit-notes/manual", { token: a.tokens.admin, body: noteBody(a) });
  const doneId = noteIdOf(done.json);
  const stockBefore = await stockOf(a.productId, a.depotId);

  const intruder = b.tokens.admin;
  assert.equal((await call(routes.detail.GET, `/api/credit-notes/${doneId}`, { token: intruder, method: "GET", id: doneId })).status, 404);
  assert.equal((await call(routes.validate.POST, `/api/credit-notes/${draftId}/validate`, { token: intruder, id: draftId })).status, 404);
  assert.equal((await call(routes.reverse.POST, `/api/credit-notes/${doneId}/reverse`, { token: intruder, id: doneId })).status, 404);

  const list = await call(routes.generic.GET, "/api/credit-notes", { token: intruder, method: "GET" });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.creditNotes, [], "the other organisation sees none of A's notes");

  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id: draftId } })).status, "DRAFT");
  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id: doneId } })).status, "VALIDATED");
  assert.equal(await stockOf(a.productId, a.depotId), stockBefore);
});

test("organisation isolation: a request cannot name another organisation's customer, product or depot (422); nothing is written", { skip: SKIP }, async () => {
  const [a, b] = [await makeOrg("own"), await makeOrg("foreign")];
  const attempts: Array<[string, Record<string, unknown>, RegExp]> = [
    ["customer", { customerId: b.customerId }, /Client introuvable/],
    ["product", { lines: [{ productId: b.productId, quantityReturned: 1 }] }, /produit selectionne est introuvable/],
    ["depot", { stockDestinationLocationId: b.depotId }, /Destination de stock non autorisee/],
  ];
  for (const [label, over, message] of attempts) {
    for (const route of [routes.manual, routes.draft] as const) {
      const result = await call(route.POST, "/api/credit-notes/x", { token: a.tokens.cashier, body: noteBody(a, over) });
      assert.equal(result.status, 422, label);
      assert.match(String(result.json.message), message, label);
    }
  }
  assert.equal(await createdNotes(a.id), 0);
  assert.equal(await stockOf(b.productId, b.depotId), 0);
  assert.equal(await stockOf(b.productId, a.depotId), 0);
});

// ---- linked return by a cashier ------------------------------------------------------------------------------------------

async function makeSale(org: Org) {
  // 5 x 80 HT, VAT 20 %: totalTTC of the line 480 (96 TTC per unit), sold at the counter.
  const sale = await prisma.sale.create({
    data: {
      organizationId: org.id,
      invoiceNumber: `INV-${uid()}`,
      origin: "COUNTER",
      status: "PAID",
      stockLocationId: org.depotId,
      customerId: org.customerId,
      subtotalHT: 400,
      taxAmount: 80,
      totalTTC: 480,
      paidAmount: 480,
      paymentMethod: "CASH",
      createdByUserId: org.userIds.admin,
      validatedAt: new Date(),
      soldAt: new Date(),
      lines: { create: [{ productId: org.productId, quantity: 5, unitPriceHT: 80, unitCostHT: 12.5, taxRate: 20, taxAmount: 80, totalHT: 400, totalTTC: 480 }] },
    },
    include: { lines: true },
  });
  return { saleId: sale.id, saleLineId: sale.lines[0].id };
}

test("a LINKED return by a cashier: priced from the sale line (never the browser), capped, customer-checked, justified, depot credited", { skip: SKIP }, async () => {
  const org = await makeOrg("linked");
  const { saleLineId } = await makeSale(org);
  const linked = (quantity: number, over: Record<string, unknown> = {}) =>
    noteBody(org, { returnMode: "LINKED", lines: [{ productId: org.productId, quantityReturned: quantity, saleLineId, unitPrice: 999, discountPercent: 77, taxRate: 0 }], ...over });
  const post = (body: unknown) => call(routes.manual.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body });

  const first = await post(linked(2));
  assert.equal(first.status, 201);
  const note = first.json.creditNote as { origin: string; totalTTC: number; lines: Array<{ unitPrice: number; taxRate: number; totalTTC: number }> };
  assert.equal(note.origin, "facture");
  assert.equal(note.lines[0].unitPrice, 80, "the sale line's price, not the 999 sent");
  assert.equal(note.lines[0].taxRate, 20);
  assert.equal(note.totalTTC, 192, "2 x 96 TTC");
  assert.equal(await stockOf(org.productId, org.depotId), 2);

  const tooMany = await post(linked(4));
  assert.equal(tooMany.status, 422, "only 3 are still returnable");
  assert.match(String(tooMany.json.message), /Quantite retournable depassee/);
  assert.equal((await post(linked(3))).status, 201, "the 3 remaining ones");
  assert.equal((await post(linked(1))).status, 422, "nothing left to return");
  assert.equal(await stockOf(org.productId, org.depotId), 5);

  const wrongCustomer = await post(linked(1, { customerId: org.otherCustomerId }));
  assert.equal(wrongCustomer.status, 422);
  const noJustification = await post(linked(1, { comment: "ok" }));
  assert.equal(noJustification.status, 422);
  assert.match(String(noJustification.json.message), /justification/);
  const toDriverless = await post(linked(1, { lines: [{ productId: org.productId, quantityReturned: 1 }] }));
  assert.equal(toDriverless.status, 422, "LINKED mode needs the sale line on every line");
  assert.equal(await createdNotes(org.id), 2, "only the two accepted notes exist");
});

test("a LINKED return naming another organisation's sale line is refused", { skip: SKIP }, async () => {
  const [a, b] = [await makeOrg("sl-a"), await makeOrg("sl-b")];
  const foreign = await makeSale(b);
  const result = await call(routes.manual.POST, "/api/credit-notes/manual", {
    token: a.tokens.cashier,
    body: noteBody(a, { returnMode: "LINKED", lines: [{ productId: a.productId, quantityReturned: 1, saleLineId: foreign.saleLineId }] }),
  });
  assert.ok([404, 422].includes(result.status), `status ${result.status}`);
  assert.equal(await createdNotes(a.id), 0);
  assert.equal(await stockOf(a.productId, a.depotId), 0);
});

// ---- price control at validation, through the real /validate route --------------------------------------------------------------

test("POST /validate: a cashier is refused (403, explicit message) on a draft whose price differs from the catalogue; nothing changes; the admin validates it", { skip: SKIP }, async () => {
  const org = await makeOrg("pv-http");
  const draft = await call(routes.draft.POST, "/api/credit-notes/draft", {
    token: org.tokens.admin,
    body: noteBody(org, { lines: [{ productId: org.productId, quantityReturned: 3, unitPrice: 80 }] }),
  });
  assert.equal(draft.status, 201);
  const id = noteIdOf(draft.json);

  const refused = await call(routes.validate.POST, `/api/credit-notes/${id}/validate`, { token: org.tokens.cashier, id });
  assert.equal(refused.status, 403);
  assert.match(String(refused.json.message), /prix differents du catalogue \(Sidi Ali 2 L\)/);
  assert.match(String(refused.json.message), /administrateur ou un responsable de depot/);
  assert.equal((await prisma.creditNote.findUniqueOrThrow({ where: { id } })).status, "DRAFT");
  assert.equal(await stockOf(org.productId, org.depotId), 0);
  assert.equal(await prisma.stockMovement.count({ where: { organizationId: org.id, referenceId: id } }), 0);
  assert.equal(await prisma.accountingEntry.count({ where: { organizationId: org.id, sourceId: id } }), 0);

  const accepted = await call(routes.validate.POST, `/api/credit-notes/${id}/validate`, { token: org.tokens.admin, id });
  assert.equal(accepted.status, 200);
  assert.equal(await stockOf(org.productId, org.depotId), 3);
});

test("POST /validate: a cashier validates a draft priced at the catalogue (200) and a draft linked to an invoice (200)", { skip: SKIP }, async () => {
  const org = await makeOrg("pv-http-ok");
  const plain = await call(routes.draft.POST, "/api/credit-notes/draft", { token: org.tokens.cashier, body: noteBody(org) });
  const plainId = noteIdOf(plain.json);
  assert.equal((await call(routes.validate.POST, `/api/credit-notes/${plainId}/validate`, { token: org.tokens.cashier, id: plainId })).status, 200);

  const { saleLineId } = await makeSale(org);
  const linked = await call(routes.draft.POST, "/api/credit-notes/draft", {
    token: org.tokens.admin,
    body: noteBody(org, { returnMode: "LINKED", lines: [{ productId: org.productId, quantityReturned: 1, saleLineId }] }),
  });
  const linkedId = noteIdOf(linked.json);
  assert.equal((await call(routes.validate.POST, `/api/credit-notes/${linkedId}/validate`, { token: org.tokens.cashier, id: linkedId })).status, 200);
  assert.equal(await stockOf(org.productId, org.depotId), 4, "3 + 1");
});
