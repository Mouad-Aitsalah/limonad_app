import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

import { businessDayRangeUtc } from "@/lib/business-day";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { DailyInvoicesPageDto, DailySalesGroupingDto } from "@/types/daily-invoice";

/**
 * Lot 3 - « Factures journalières »: the REAL route handlers GET /api/daily-invoices and
 * GET /api/daily-invoices/sales-grouping, the REAL session lookup (a Session row sent as a
 * Bearer token), the REAL module guard and the REAL server code, against a THROWAWAY
 * PostgreSQL database. Only `next/headers` is replaced (there is no Next request scope in a
 * test). Read-only routes: the tests only write their own fixtures, in their own organisations.
 *
 * Safety: the file does nothing unless D2_TEST_DATABASE_URL names the local database
 * `commdis_d2_test` AND DATABASE_URL is that very URL (run it with `npm run test:db`).
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

type Handler = (request: Request) => Promise<Response>;
let prisma: PrismaClient;
let pageRoute: { GET: Handler };
let groupingRoute: { GET: Handler };
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
  pageRoute = (await import("@/app/api/daily-invoices/route")) as { GET: Handler };
  groupingRoute = (await import("@/app/api/daily-invoices/sales-grouping/route")) as { GET: Handler };
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (!SKIP) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);
const round2 = (value: number) => Math.round(value * 100) / 100;

type Role = "admin" | "depot_manager" | "cashier" | "driverA" | "driverB";
const PRISMA_ROLE = { admin: "ADMIN", depot_manager: "DEPOT_MANAGER", cashier: "CASHIER", driverA: "DRIVER", driverB: "DRIVER" } as const;

let saleSeq = 1000;

async function makeOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `DI-${label}-${suffix}`.toUpperCase(), name: `Daily ${label}` } });
  const tokens = {} as Record<Role, string>;
  const userIds = {} as Record<Role, string>;
  for (const role of Object.keys(PRISMA_ROLE) as Role[]) {
    const user = await prisma.user.create({
      data: { organizationId: organization.id, firstName: role, lastName: label, fullName: `${role} ${label}`, email: `di-${role}-${suffix}@example.invalid`, passwordHash: "x", role: PRISMA_ROLE[role] },
    });
    const token = `tok-${role}-${suffix}-${randomUUID()}`;
    await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    tokens[role] = token;
    userIds[role] = user.id;
  }
  const depotRow = await prisma.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depotRow.id } });
  const category = await prisma.category.create({ data: { organizationId: organization.id, name: "Boissons" } });
  const sidi = await prisma.product.create({
    data: { organizationId: organization.id, reference: `SA2-${suffix}`, name: "Sidi Ali 2 L", categoryId: category.id, purchasePrice: 12.5, salePrice: 16.67, taxRate: 20, unit: "unite" },
  });
  const oulmes = await prisma.product.create({
    data: { organizationId: organization.id, reference: `OU1-${suffix}`, name: "Oulmès 1 L", categoryId: category.id, purchasePrice: 0, salePrice: 5, taxRate: 20, unit: "unite" },
  });
  return { id: organization.id, tokens, userIds, locationId: location.id, sidi: sidi.id, oulmes: oulmes.id };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

type LineSpec = { productId: string; quantity: number; unitTTC: number; cost: number; lineCreatedAt?: Date };

/** A sale written directly (the routes under test only read): line totals as the POS stores them. */
async function sale(org: Org, spec: { by: Role; at: Date; status?: "VALIDATED" | "PAID" | "CREDIT" | "DRAFT" | "CANCELLED"; method?: "CASH" | "CREDIT"; origin?: "COUNTER" | "TRUCK"; rounding?: number; lines: LineSpec[] }) {
  const lines = spec.lines.map((line) => {
    const totalTTC = round2(line.quantity * line.unitTTC);
    const totalHT = round2(totalTTC / 1.2);
    return { ...line, totalTTC, totalHT, taxAmount: round2(totalTTC - totalHT), unitPriceHT: round2(line.unitTTC / 1.2) };
  });
  const subtotalHT = round2(lines.reduce((sum, line) => sum + line.totalHT, 0));
  const taxAmount = round2(lines.reduce((sum, line) => sum + line.taxAmount, 0));
  const rounding = spec.rounding ?? 0;
  const totalTTC = round2(subtotalHT + taxAmount + rounding);
  const method = spec.method ?? "CASH";
  saleSeq += 1;
  const created = await prisma.sale.create({
    data: {
      organizationId: org.id,
      invoiceNumber: `DI-${uid()}`,
      saleYear: 2026,
      saleNumber: saleSeq,
      origin: spec.origin ?? "TRUCK",
      status: spec.status ?? (method === "CREDIT" ? "CREDIT" : "PAID"),
      stockLocationId: org.locationId,
      subtotalHT,
      taxAmount,
      totalTTC,
      roundingAmount: rounding,
      paidAmount: method === "CASH" ? totalTTC : 0,
      creditAmount: method === "CREDIT" ? totalTTC : 0,
      paymentMethod: method,
      createdByUserId: org.userIds[spec.by],
      createdAt: spec.at,
      validatedAt: spec.at,
      lines: {
        create: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPriceHT: line.unitPriceHT,
          unitCostHT: line.cost,
          taxRate: 20,
          taxAmount: line.taxAmount,
          totalHT: line.totalHT,
          totalTTC: line.totalTTC,
          ...(line.lineCreatedAt ? { createdAt: line.lineCreatedAt } : {}),
        })),
      },
    },
  });
  if (method === "CASH" && (spec.status ?? "PAID") !== "DRAFT") {
    await prisma.payment.create({
      data: { organizationId: org.id, paymentNumber: `PAY-${uid()}`, saleId: created.id, amount: totalTTC, method: "CASH", status: "VALIDATED", receivedByUserId: org.userIds[spec.by], receivedAt: spec.at },
    });
  }
  return created;
}

const { start, day } = businessDayRangeUtc("");
const inDay = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

/**
 * The day of the tests (all users):
 *  S1 driver A, cash   : Sidi 2 x 20,00 + Oulmès 1 x 6,00 (Oulmès has no cost)
 *  S2 driver A, credit : Sidi 1 x 20,00 + Sidi 1 x 19,00
 *  S3 cashier, counter : Oulmès 2 x 6,15 + commercial rounding 0,20
 *  S8 driver B, cash   : Sidi 1 x 18,00 on a line older than the cost snapshot (approximate cost)
 * Outside the scope: S4 driver B the day before, S5 a DRAFT, S6 a CANCELLED, S7 another organisation.
 */
async function seed() {
  const org = await makeOrg("A");
  const other = await makeOrg("B");
  await sale(org, { by: "driverA", at: inDay(60), lines: [{ productId: org.sidi, quantity: 2, unitTTC: 20, cost: 12.5 }, { productId: org.oulmes, quantity: 1, unitTTC: 6, cost: 0 }] });
  await sale(org, { by: "driverA", at: inDay(90), method: "CREDIT", lines: [{ productId: org.sidi, quantity: 1, unitTTC: 20, cost: 12.5 }, { productId: org.sidi, quantity: 1, unitTTC: 19, cost: 12.5 }] });
  await sale(org, { by: "cashier", at: inDay(120), origin: "COUNTER", rounding: 0.2, lines: [{ productId: org.oulmes, quantity: 2, unitTTC: 6.15, cost: 0 }] });
  await sale(org, { by: "driverB", at: inDay(150), lines: [{ productId: org.sidi, quantity: 1, unitTTC: 18, cost: 12.5, lineCreatedAt: new Date("2026-01-15T10:00:00.000Z") }] });
  await sale(org, { by: "driverB", at: new Date(start.getTime() - 60 * 60_000), lines: [{ productId: org.sidi, quantity: 5, unitTTC: 20, cost: 12.5 }] });
  await sale(org, { by: "driverA", at: inDay(30), status: "DRAFT", lines: [{ productId: org.sidi, quantity: 9, unitTTC: 20, cost: 12.5 }] });
  await sale(org, { by: "driverA", at: inDay(45), status: "CANCELLED", lines: [{ productId: org.sidi, quantity: 7, unitTTC: 20, cost: 12.5 }] });
  await sale(other, { by: "driverA", at: inDay(60), lines: [{ productId: other.sidi, quantity: 3, unitTTC: 20, cost: 12.5 }] });
  return org;
}

let seeded: Promise<Org> | null = null;
const fixtures = () => (seeded ??= seed());

async function call<T>(route: { GET: Handler }, path: string, role: Role, org: Org, query: Record<string, string> = {}) {
  currentToken = org.tokens[role];
  const url = new URL(`https://app.test${path}`);
  url.searchParams.set("day", day);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await route.GET(new Request(url, { headers: { authorization: `Bearer ${currentToken}` } }));
  const raw = await response.text();
  return { status: response.status, raw, body: (raw ? JSON.parse(raw) : null) as T };
}
const grouping = (role: Role, org: Org, query: Record<string, string> = {}) => call<DailySalesGroupingDto>(groupingRoute, "/api/daily-invoices/sales-grouping", role, org, query);
const page = (role: Role, org: Org, query: Record<string, string> = {}) => call<DailyInvoicesPageDto>(pageRoute, "/api/daily-invoices", role, org, query);

const priceRows = (body: DailySalesGroupingDto, name: string) =>
  body.products.find((product) => product.name === name)?.priceGroups.map((group) => [group.unitPriceTTC, group.quantity, group.amountTTC]);

test("grouping of the whole day: one row per applied price, product totals, nothing outside the scope (other day, draft, cancelled, other organisation)", { skip: SKIP }, async () => {
  const org = await fixtures();
  const { status, body } = await grouping("admin", org);
  assert.equal(status, 200);
  assert.equal(body.invoiceCount, 4);
  assert.deepEqual(priceRows(body, "Sidi Ali 2 L"), [[20, 3, 60], [19, 1, 19], [18, 1, 18]]);
  assert.deepEqual(priceRows(body, "Oulmès 1 L"), [[6.15, 2, 12.3], [6, 1, 6]]);
  const sidi = body.products.find((product) => product.name === "Sidi Ali 2 L")!;
  assert.equal(sidi.totalQuantity, 5);
  assert.equal(sidi.totalTTC, 97);
  assert.deepEqual(body.totals, { productCount: 2, totalQuantity: 8, linesTotalTTC: 115.3, roundingTotal: 0.2, revenueTotal: 115.5, reconciliationGap: 0, reconciled: true });
});

test("reconciliation with the EXISTING CA total of the page: products + commercial rounding = kpis.revenueTotal, for each filter", { skip: SKIP }, async () => {
  const org = await fixtures();
  const queries: Array<Record<string, string>> = [{}, { userIds: org.userIds.driverA }, { userIds: org.userIds.cashier }, { paymentMethod: "CREDIT" }];
  for (const query of queries) {
    const [p, g] = await Promise.all([page("admin", org, query), grouping("admin", org, query)]);
    assert.equal(g.body.totals.revenueTotal, p.body.kpis.revenueTotal, JSON.stringify(query));
    assert.equal(g.body.invoiceCount, p.body.kpis.invoiceCount, JSON.stringify(query));
    assert.equal(g.body.totals.reconciled, true, JSON.stringify(query));
  }
});

test("user filter: driver A alone gives the business example (Sidi Ali: 3 x 20 = 60, 1 x 19 = 19, total 4 / 79)", { skip: SKIP }, async () => {
  const org = await fixtures();
  const { body } = await grouping("admin", org, { userIds: org.userIds.driverA });
  assert.deepEqual(priceRows(body, "Sidi Ali 2 L"), [[20, 3, 60], [19, 1, 19]]);
  const sidi = body.products.find((product) => product.name === "Sidi Ali 2 L")!;
  assert.equal(sidi.totalQuantity, 4);
  assert.equal(sidi.totalTTC, 79);
  assert.equal(body.totals.revenueTotal, 85);
  const both = await grouping("admin", org, { userIds: `${org.userIds.driverA},${org.userIds.driverB}` });
  assert.deepEqual(priceRows(both.body, "Sidi Ali 2 L"), [[20, 3, 60], [19, 1, 19], [18, 1, 18]], "several users selected");
});

test("counter sales (cashier, no driver) are included and keep their commercial rounding on its own line", { skip: SKIP }, async () => {
  const org = await fixtures();
  const { body } = await grouping("admin", org, { userIds: org.userIds.cashier });
  assert.deepEqual(priceRows(body, "Oulmès 1 L"), [[6.15, 2, 12.3]]);
  assert.equal(body.totals.linesTotalTTC, 12.3);
  assert.equal(body.totals.roundingTotal, 0.2);
  assert.equal(body.totals.revenueTotal, 12.5);
});

test("date and payment filters: another business day returns nothing of today; the CREDIT filter keeps only the credit invoice", { skip: SKIP }, async () => {
  const org = await fixtures();
  const yesterday = new Date(start.getTime() - 12 * 3_600_000).toISOString().slice(0, 10);
  const previous = await grouping("admin", org, { day: yesterday });
  assert.deepEqual(priceRows(previous.body, "Sidi Ali 2 L"), [[20, 5, 100]], "only the sale of the day before");
  const credit = await grouping("admin", org, { paymentMethod: "CREDIT" });
  assert.deepEqual(priceRows(credit.body, "Sidi Ali 2 L"), [[20, 1, 20], [19, 1, 19]]);
  assert.equal(credit.body.totals.revenueTotal, 39);
});

test("admin: margin HT and taux de marque over the reliable lines only; missing and approximate costs are reported, the margin is partial", { skip: SKIP }, async () => {
  const org = await fixtures();
  const expected = { marginHT: 15.83, revenueHT: 65.83, markupRate: 24.05, partial: true, missingCostLines: 2, approximateCostLines: 1 };
  const { body } = await grouping("admin", org);
  assert.deepEqual(
    { marginHT: body.margin!.marginHT, revenueHT: body.margin!.revenueHT, markupRate: body.margin!.markupRate, partial: body.margin!.partial, missingCostLines: body.margin!.missingCostLines, approximateCostLines: body.margin!.approximateCostLines },
    expected,
  );
  const oulmes = body.products.find((product) => product.name === "Oulmès 1 L")!;
  assert.equal(oulmes.margin!.markupRate, null, "no reliable cost at all: « — », no artificial margin");
  assert.equal(oulmes.margin!.marginHT, 0);
  assert.equal(oulmes.margin!.missingCostLines, 2);
  // the page's table: margin per applied price, same rule (the 18,00 line has an approximate cost: excluded, « — »)
  const sidi = body.products.find((product) => product.name === "Sidi Ali 2 L")!;
  assert.deepEqual(
    sidi.priceGroups.map((group) => [group.unitPriceTTC, group.margin!.marginHT, group.margin!.markupRate, group.margin!.partial]),
    [
      [20, 12.5, 25, false],
      [19, 3.33, 21.04, false],
      [18, 0, null, true],
    ],
  );
  const kpis = (await page("admin", org)).body.kpis;
  assert.equal(kpis.margin!.marginHT, 15.83, "the KPI card and the grouping agree");
  assert.equal(kpis.margin!.markupRate, 24.05);
  assert.equal(kpis.margin!.partial, true);
});

test("depot manager and cashier: the same quantities and amounts, but NO margin field and no cost anywhere in the API answers", { skip: SKIP }, async () => {
  const org = await fixtures();
  const admin = await grouping("admin", org);
  for (const role of ["depot_manager", "cashier"] as const) {
    const g = await grouping(role, org);
    assert.equal(g.status, 200, role);
    // the admin's price rows also carry a margin; everything else must be identical
    const withoutMargin = (groups: DailySalesGroupingDto["products"][number]["priceGroups"]) =>
      groups.map(({ unitPriceTTC, quantity, amountTTC }) => ({ unitPriceTTC, quantity, amountTTC }));
    assert.deepEqual(
      g.body.products.map((product) => [product.name, product.priceGroups, product.totalQuantity, product.totalTTC]),
      admin.body.products.map((product) => [product.name, withoutMargin(product.priceGroups), product.totalQuantity, product.totalTTC]),
      role,
    );
    assert.deepEqual(g.body.totals, admin.body.totals, role);
    for (const raw of [g.raw, (await page(role, org)).raw]) {
      assert.equal(/margin|markup|unitCost|cost/i.test(raw), false, `${role}: no margin or cost in ${raw.slice(0, 60)}`);
    }
  }
});

test("the grouping page gets the same « Utilisateur / Chauffeur » options as the daily invoices page (own organisation only)", { skip: SKIP }, async () => {
  const org = await fixtures();
  const [p, g] = await Promise.all([page("cashier", org), grouping("cashier", org)]);
  assert.deepEqual(g.body.userOptions, p.body.userOptions);
  assert.deepEqual(new Set(g.body.userOptions.map((option) => option.id)), new Set(Object.values(org.userIds)));
});

test("a driver is refused on both routes (403), and an organisation never sees another one's sales", { skip: SKIP }, async () => {
  const org = await fixtures();
  for (const route of [page, grouping]) {
    const refused = await route("driverA", org);
    assert.equal(refused.status, 403);
    assert.equal(/margin|Sidi|totalTTC/.test(refused.raw), false);
  }
  const other = await prisma.organization.findFirst({ where: { name: "Daily B", id: { not: org.id } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  assert.ok(other);
  const { body } = await grouping("admin", org);
  assert.equal(body.totals.totalQuantity, 8, "the 3 units sold by the other organisation are not counted");
});
