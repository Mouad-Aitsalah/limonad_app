import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Avoir « Rembourser » - the whole flow over HTTP, against a THROWAWAY PostgreSQL database: the POS-style
 * « Encaisser » request (POST /api/credit-notes/manual), the cash going OUT of the till exactly once, the
 * document showing in « Archives des factures » (/api/sales-history) and « Factures journalières »
 * (/api/daily-invoices) with the payment « Rembourser », and the roles allowed to do it.
 *
 * Same safety as the other credit note HTTP tests: nothing runs unless D2_TEST_DATABASE_URL names the local
 * database `commdis_d2_test` AND DATABASE_URL is that very URL; run it through `npm run test:db`.
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
let prisma: PrismaClient;
let manualRoute: { POST: Handler };
let historyRoute: { GET: Handler };
let dailyRoute: { GET: Handler };
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
  manualRoute = (await import("@/app/api/credit-notes/manual/route")) as { POST: Handler };
  historyRoute = (await import("@/app/api/sales-history/route")) as { GET: Handler };
  dailyRoute = (await import("@/app/api/daily-invoices/route")) as { GET: Handler };
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (!SKIP) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);

type Role = "admin" | "depot_manager" | "cashier" | "driver";
const PRISMA_ROLE = { admin: "ADMIN", depot_manager: "DEPOT_MANAGER", cashier: "CASHIER", driver: "DRIVER" } as const;

async function makeOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `RF-${label}-${suffix}`.toUpperCase(), name: `Refund ${label}` } });
  const tokens = {} as Record<Role, string>;
  const userIds = {} as Record<Role, string>;
  for (const role of Object.keys(PRISMA_ROLE) as Role[]) {
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        firstName: role,
        lastName: label,
        fullName: `${role} ${label}`,
        email: `rf-${role}-${suffix}@example.invalid`,
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
  const category = await prisma.category.create({ data: { organizationId: organization.id, name: "Boissons" } });
  const supplier = await prisma.supplier.create({ data: { organizationId: organization.id, code: `F-${suffix}`, name: "Fournisseur 1" } });
  const product = await prisma.product.create({
    data: { organizationId: organization.id, reference: `P-${suffix}`, name: "Sidi Ali 2 L", categoryId: category.id, defaultSupplierId: supplier.id, purchasePrice: 12.5, salePrice: 100, taxRate: 20, unit: "unite" },
  });
  const customer = await prisma.customer.create({
    data: { organizationId: organization.id, code: `C-${suffix}`, name: "Client Rembourse", address: "-", city: "-", type: "GROCERY", createdByUserId: userIds.admin, creationOrigin: "ADMIN" },
  });
  return { id: organization.id, tokens, userIds, depotId: depot.id, productId: product.id, customerId: customer.id, supplierId: supplier.id };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

/** What the POS-style screen sends: validated at once, MANUAL, refunded in cash, one key per avoir. */
function refundBody(org: Org, over: Record<string, unknown> = {}) {
  return {
    partyType: "client",
    customerId: org.customerId,
    returnMode: "MANUAL",
    refundMode: "remboursement_especes",
    reason: "retour_commercial",
    comment: "Produit rendu au comptoir",
    returnDate: new Date().toISOString().slice(0, 10),
    stockDestinationLocationId: org.depotId,
    lines: [{ productId: org.productId, quantityReturned: 2, unitPrice: 100, discountPercent: 0, taxRate: 20 }],
    idempotencyKey: randomUUID(),
    ...over,
  };
}

async function call(handler: Handler, path: string, options: { token: string | null; method?: "GET" | "POST"; body?: unknown }) {
  currentToken = options.token;
  const headers: Record<string, string> = { "x-forwarded-host": "app.test", "x-forwarded-proto": "https", origin: ORIGIN };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(`${ORIGIN}${path}`, {
    method: options.method ?? "POST",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const response = await handler(request);
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

type ListItem = { id: string; kind?: string; paymentMethod: string; totalTTC: number; paidAmount: number; invoiceNumber: string; status: string; partyType?: string };
const itemsOf = (json: Record<string, unknown>) => (json.items ?? []) as ListItem[];

/** Net movement of the till (account 51611) caused by the organisation's entries: debit - credit. */
async function tillMovement(orgId: string): Promise<number> {
  const lines = await prisma.accountingEntryLine.findMany({
    where: { account: { code: "51611" }, entry: { organizationId: orgId } },
    select: { debit: true, credit: true },
  });
  return Math.round(lines.reduce((sum, line) => sum + line.debit.toNumber() - line.credit.toNumber(), 0) * 100) / 100;
}

const stockOf = async (productId: string, locationId: string) =>
  (await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity ?? 0;

async function seedSale(org: Org, totalTTC: number) {
  const subtotalHT = Math.round((totalTTC / 1.2) * 100) / 100;
  const now = new Date(Date.now() - 5_000);
  const locationRow = await prisma.stockLocation.findFirstOrThrow({ where: { organizationId: org.id, type: "DEPOT" } });
  const sale = await prisma.sale.create({
    data: {
      organizationId: org.id,
      invoiceNumber: `RF-S-${uid()}`,
      saleYear: 2026,
      saleNumber: Math.floor(Math.random() * 1_000_000),
      origin: "COUNTER",
      status: "PAID",
      stockLocationId: locationRow.id,
      subtotalHT,
      taxAmount: Math.round((totalTTC - subtotalHT) * 100) / 100,
      totalTTC,
      paidAmount: totalTTC,
      creditAmount: 0,
      paymentMethod: "CASH",
      createdByUserId: org.userIds.cashier,
      createdAt: now,
      validatedAt: now,
      lines: {
        create: [{ productId: org.productId, quantity: 1, unitPriceHT: subtotalHT, unitCostHT: 12.5, taxRate: 20, taxAmount: Math.round((totalTTC - subtotalHT) * 100) / 100, totalHT: subtotalHT, totalTTC }],
      },
    },
  });
  await prisma.payment.create({
    data: { organizationId: org.id, paymentNumber: `PAY-${uid()}`, saleId: sale.id, amount: totalTTC, method: "CASH", status: "VALIDATED", receivedByUserId: org.userIds.cashier, receivedAt: now },
  });
  return sale;
}

test("« Encaisser » by the cashier: the avoir is saved once, the till goes DOWN by the refunded amount, the stock comes back", { skip: SKIP }, async () => {
  const org = await makeOrg("cash");
  const body = refundBody(org);
  const first = await call(manualRoute.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const note = first.json.creditNote as { id: string; status: string; totalTTC: number; refundMode: string; number: string };
  assert.equal(note.status, "VALIDE");
  assert.equal(note.refundMode, "remboursement_especes");
  assert.equal(note.totalTTC, 240, "2 x 100 HT x 1.20");
  assert.equal(await stockOf(org.productId, org.depotId), 2);
  assert.equal(await tillMovement(org.id), -240, "cash OUT: the till balance decreases by the amount refunded, never increases");

  // a second click / a retry of the same submission (same key) returns the same avoir and changes nothing
  const replay = await call(manualRoute.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body });
  assert.ok([200, 201].includes(replay.status), JSON.stringify(replay.json));
  assert.equal((replay.json.creditNote as { id: string }).id, note.id);
  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), 1);
  assert.equal(await stockOf(org.productId, org.depotId), 2, "stock credited once");
  assert.equal(await tillMovement(org.id), -240, "the refund is counted once in the till");
  assert.equal(await prisma.accountingEntry.count({ where: { organizationId: org.id, sourceId: note.id } }), 1, "one accounting entry");
});

test("two simultaneous « Encaisser » requests with the same key create ONE avoir and ONE cash refund", { skip: SKIP }, async () => {
  const org = await makeOrg("double");
  const body = refundBody(org);
  const results = await Promise.all([
    call(manualRoute.POST, "/api/credit-notes/manual", { token: org.tokens.admin, body }),
    call(manualRoute.POST, "/api/credit-notes/manual", { token: org.tokens.admin, body }),
  ]);
  for (const result of results) assert.ok([200, 201].includes(result.status), JSON.stringify(result.json));
  assert.equal(new Set(results.map((result) => (result.json.creditNote as { id: string }).id)).size, 1);
  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), 1);
  assert.equal(await tillMovement(org.id), -240);
  assert.equal(await stockOf(org.productId, org.depotId), 2);
});

test("the avoir shows in « Archives des factures » with payment « Rembourser » and is never added to a sale", { skip: SKIP }, async () => {
  const org = await makeOrg("archives");
  const sale = await seedSale(org, 120);
  const created = await call(manualRoute.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body: refundBody(org) });
  const note = created.json.creditNote as { id: string; number: string };

  const all = await call(historyRoute.GET, "/api/sales-history?includeCreditNotes=1", { token: org.tokens.admin, method: "GET" });
  assert.equal(all.status, 200);
  const rows = itemsOf(all.json);
  const credit = rows.find((row) => row.id === note.id);
  assert.ok(credit, "the avoir is listed");
  assert.equal(credit.kind, "CREDIT_NOTE");
  assert.equal(credit.paymentMethod, "REFUND");
  assert.equal(credit.invoiceNumber, note.number);
  assert.equal(credit.totalTTC, -240, "a refund is a negative amount");
  assert.equal(credit.paidAmount, -240);
  assert.equal(credit.partyType, "client");
  const invoice = rows.find((row) => row.id === sale.id);
  assert.ok(invoice && invoice.kind === undefined, "the invoice row is unchanged");
  assert.equal(invoice.totalTTC, 120, "the sale amount is not altered by the avoir");
  assert.equal(all.json.totalCount, 2);

  // opt-in: without the flag (drill-downs, AI lookup) only invoices
  const plain = await call(historyRoute.GET, "/api/sales-history", { token: org.tokens.admin, method: "GET" });
  assert.deepEqual(itemsOf(plain.json).map((row) => row.id), [sale.id]);

  // « Rembourser » filter: the avoir only; another payment mode: the invoices only
  const refundOnly = await call(historyRoute.GET, "/api/sales-history?includeCreditNotes=1&paymentMethod=REFUND", { token: org.tokens.admin, method: "GET" });
  assert.deepEqual(itemsOf(refundOnly.json).map((row) => row.id), [note.id]);
  const cashOnly = await call(historyRoute.GET, "/api/sales-history?includeCreditNotes=1&paymentMethod=CASH", { token: org.tokens.admin, method: "GET" });
  assert.deepEqual(itemsOf(cashOnly.json).map((row) => row.id), [sale.id]);

  // search by the avoir number
  const searched = await call(historyRoute.GET, `/api/sales-history?includeCreditNotes=1&search=${encodeURIComponent(note.number)}`, { token: org.tokens.admin, method: "GET" });
  assert.deepEqual(itemsOf(searched.json).map((row) => row.id), [note.id]);
});

test("the avoir shows in « Factures journalières » with payment « Rembourser » while the day's KPIs stay those of the sales", { skip: SKIP }, async () => {
  const org = await makeOrg("daily");
  const sale = await seedSale(org, 120);
  const before = await call(dailyRoute.GET, "/api/daily-invoices", { token: org.tokens.admin, method: "GET" });
  assert.equal(before.status, 200);
  const created = await call(manualRoute.POST, "/api/credit-notes/manual", { token: org.tokens.cashier, body: refundBody(org) });
  const note = created.json.creditNote as { id: string };

  const after = await call(dailyRoute.GET, "/api/daily-invoices", { token: org.tokens.admin, method: "GET" });
  assert.equal(after.status, 200);
  const rows = itemsOf(after.json);
  const credit = rows.find((row) => row.id === note.id);
  assert.ok(credit, "the avoir is in the day's list");
  assert.equal(credit.paymentMethod, "REFUND");
  assert.equal(credit.totalTTC, -240);
  assert.ok(rows.some((row) => row.id === sale.id));

  const kpisBefore = before.json.kpis as { invoiceCount: number; revenueTotal: number; byMethod: unknown; breakdownTotal: number; reconciled: boolean };
  const kpisAfter = after.json.kpis as typeof kpisBefore;
  assert.deepEqual(kpisAfter, kpisBefore, "the sales KPIs (count, CA, per-method breakdown) did not move: the refund is not counted a second time");
  assert.equal(kpisAfter.invoiceCount, 1);
  assert.equal(kpisAfter.revenueTotal, 120);
  assert.equal(kpisAfter.reconciled, true);

  const refundOnly = await call(dailyRoute.GET, "/api/daily-invoices?paymentMethod=REFUND", { token: org.tokens.admin, method: "GET" });
  assert.deepEqual(itemsOf(refundOnly.json).map((row) => row.id), [note.id]);
  const cashOnly = await call(dailyRoute.GET, "/api/daily-invoices?paymentMethod=CASH", { token: org.tokens.admin, method: "GET" });
  assert.deepEqual(itemsOf(cashOnly.json).map((row) => row.id), [sale.id]);
});

test("a supplier avoir is listed as « Rembourser » too and moves no cash", { skip: SKIP }, async () => {
  const org = await makeOrg("supplier");
  await prisma.stockLevel.upsert({
    where: { productId_locationId: { productId: org.productId, locationId: org.depotId } },
    create: { organizationId: org.id, productId: org.productId, locationId: org.depotId, quantity: 10 },
    update: { quantity: 10 },
  });
  const created = await call(manualRoute.POST, "/api/credit-notes/manual", {
    token: org.tokens.cashier,
    body: {
      partyType: "fournisseur",
      supplierId: org.supplierId,
      reason: "produit_defectueux",
      comment: "",
      returnDate: new Date().toISOString().slice(0, 10),
      stockSourceLocationId: org.depotId,
      lines: [{ productId: org.productId, quantityReturned: 2, unitPrice: 12.5, discountPercent: 0, taxRate: 20 }],
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const note = created.json.creditNote as { id: string };
  assert.equal(await tillMovement(org.id), 0, "no till movement for a supplier note");
  const history = await call(historyRoute.GET, "/api/sales-history?includeCreditNotes=1", { token: org.tokens.admin, method: "GET" });
  const row = itemsOf(history.json).find((item) => item.id === note.id);
  assert.ok(row);
  assert.equal(row.paymentMethod, "REFUND");
  assert.equal(row.partyType, "fournisseur");
  assert.equal(row.paidAmount, 0);
});

test("only the administrator and the cashier create an avoir: the depot manager and the driver get 403 and nothing is written", { skip: SKIP }, async () => {
  const org = await makeOrg("roles");
  for (const role of ["depot_manager", "driver"] as const) {
    const refused = await call(manualRoute.POST, "/api/credit-notes/manual", { token: org.tokens[role], body: refundBody(org) });
    assert.equal(refused.status, 403, role);
  }
  const anonymous = await call(manualRoute.POST, "/api/credit-notes/manual", { token: null, body: refundBody(org) });
  assert.equal(anonymous.status, 401);
  assert.equal(await prisma.creditNote.count({ where: { organizationId: org.id } }), 0);
  assert.equal(await tillMovement(org.id), 0);
  assert.equal(await stockOf(org.productId, org.depotId), 0);
  for (const role of ["admin", "cashier"] as const) {
    const ok = await call(manualRoute.POST, "/api/credit-notes/manual", { token: org.tokens[role], body: refundBody(org) });
    assert.equal(ok.status, 201, role);
  }
  assert.equal(await tillMovement(org.id), -480);
});

test("another organisation never sees the avoir in its lists", { skip: SKIP }, async () => {
  const [a, b] = [await makeOrg("iso-a"), await makeOrg("iso-b")];
  const created = await call(manualRoute.POST, "/api/credit-notes/manual", { token: a.tokens.admin, body: refundBody(a) });
  const noteId = (created.json.creditNote as { id: string }).id;
  const history = await call(historyRoute.GET, "/api/sales-history?includeCreditNotes=1", { token: b.tokens.admin, method: "GET" });
  assert.equal(itemsOf(history.json).some((row) => row.id === noteId), false);
  const daily = await call(dailyRoute.GET, "/api/daily-invoices", { token: b.tokens.admin, method: "GET" });
  assert.equal(itemsOf(daily.json).some((row) => row.id === noteId), false);
});

test("a normal sale is unaffected: the lists without any avoir are identical with and without the flag", { skip: SKIP }, async () => {
  const org = await makeOrg("normal");
  const sale = await seedSale(org, 60);
  const plain = await call(historyRoute.GET, "/api/sales-history", { token: org.tokens.admin, method: "GET" });
  const flagged = await call(historyRoute.GET, "/api/sales-history?includeCreditNotes=1", { token: org.tokens.admin, method: "GET" });
  assert.deepEqual(plain.json, flagged.json);
  assert.deepEqual(itemsOf(plain.json).map((row) => row.id), [sale.id]);
});
