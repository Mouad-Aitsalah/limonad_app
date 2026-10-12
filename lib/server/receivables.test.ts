import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

import { computeCustomerDebt } from "./customer-debt";
import {
  loadCustomerBalances,
  loadCustomerReceivableDetail,
  loadReceivablesOverview,
  readReceivablesSettings,
  ReceivablesError,
  writeReceivablesSettings,
} from "./receivables-core";

/**
 * Dashboard « Créances clients » against a REAL database (run it on the
 * isolated test database): every test runs inside a transaction that is always
 * rolled back - nothing is kept. Skipped when no database is reachable. Plus the
 * server-side admin-only gating (source level).
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  try {
    await Promise.race([prisma.$queryRaw`select 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000))]);
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

async function inRollback(run: (tx: Tx) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await run(tx);
        throw new Rollback();
      },
      { timeout: 90_000, maxWait: 20_000 },
    ),
    Rollback,
  );
}

// Reference instant: 15/06/2026 12:00 UTC = business day 2026-06-15 (Casablanca UTC+1).
const NOW = new Date("2026-06-15T12:00:00Z");
const SETTINGS = { overdueDays: 30, isDefault: true };
/** An instant `days` business days before NOW (midday, far from the 02:00 cut). */
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

async function makeOrg(tx: Tx, label: string) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-RCV-${suffix}`.toUpperCase(), name: `Test créances ${label}` } });
  const admin = await tx.user.create({
    data: { organizationId: organization.id, firstName: "A", lastName: label, fullName: `Admin ${label}`, email: `r-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id } });
  const supplier = await tx.supplier.create({ data: { organizationId: organization.id, code: `S-${suffix}`, name: "Fournisseur" } });
  return { organization, admin, location, supplier };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

async function makeCustomer(tx: Tx, org: Org, name: string) {
  return tx.customer.create({
    data: { organizationId: org.organization.id, code: `C-${uid()}`, name, address: "-", city: "-", type: "GROCERY", status: "ACTIVE", createdByUserId: org.admin.id, creationOrigin: "ADMIN" },
  });
}

type SaleStatus = "DRAFT" | "VALIDATED" | "PARTIALLY_PAID" | "PAID" | "CREDIT" | "CANCELLED" | "CREDIT_NOTED";

async function makeSale(
  tx: Tx,
  org: Org,
  customerId: string,
  options: { status?: SaleStatus; total?: number; paid?: number; credit?: number; at?: Date; soldAt?: Date | null },
) {
  const total = options.total ?? 1000;
  const credit = options.credit ?? total;
  const at = options.at ?? daysAgo(5);
  return tx.sale.create({
    data: {
      organizationId: org.organization.id,
      invoiceNumber: `T-${uid()}`,
      origin: "COUNTER",
      status: options.status ?? "CREDIT",
      customerId,
      stockLocationId: org.location.id,
      subtotalHT: total,
      taxAmount: 0,
      totalTTC: total,
      paidAmount: options.paid ?? total - credit,
      creditAmount: credit,
      paymentMethod: credit === total ? "CREDIT" : credit > 0 ? "MIXED" : "CASH",
      createdByUserId: org.admin.id,
      validatedAt: options.status === "DRAFT" ? null : at,
      soldAt: options.soldAt ?? null,
      createdAt: at,
    },
  });
}

async function makeCreditNote(
  tx: Tx,
  org: Org,
  customerId: string | null,
  options: { total: number; status?: "DRAFT" | "VALIDATED" | "REVERSED"; refundMethod?: "CASH" | "BANK"; partyType?: "CUSTOMER" | "SUPPLIER"; at?: Date; originalSaleId?: string | null },
) {
  const at = options.at ?? daysAgo(2);
  return tx.creditNote.create({
    data: {
      organizationId: org.organization.id,
      creditNoteNumber: `AV-${uid()}`,
      partyType: options.partyType ?? "CUSTOMER",
      customerId: options.partyType === "SUPPLIER" ? null : customerId,
      supplierId: options.partyType === "SUPPLIER" ? org.supplier.id : null,
      originalSaleId: options.originalSaleId ?? null,
      status: options.status ?? "VALIDATED",
      refundMethod: options.refundMethod ?? "CASH",
      reason: "DEFECTIVE_PRODUCT",
      subtotalHT: options.total,
      taxAmount: 0,
      totalTTC: options.total,
      createdByUserId: org.admin.id,
      validatedAt: options.status === "DRAFT" ? null : at,
      createdAt: at,
    },
  });
}

async function makeSettlement(tx: Tx, org: Org, customerId: string, options: { amount: number; status?: "VALIDATED" | "CANCELLED"; day?: string }) {
  return tx.customerSettlement.create({
    data: {
      organizationId: org.organization.id,
      settlementNumber: `REGL-${uid()}`,
      customerId,
      date: new Date(`${options.day ?? "2026-06-10"}T00:00:00Z`),
      amount: options.amount,
      method: "CASH",
      status: options.status ?? "VALIDATED",
      createdByUserId: org.admin.id,
    },
  });
}

/** A mix of every case the formula must handle; returns the customers. */
async function seedMixedOrg(tx: Tx, org: Org) {
  const plain = await makeCustomer(tx, org, "A - crédit simple");
  await makeSale(tx, org, plain.id, { total: 1000 });

  const partial = await makeCustomer(tx, org, "B - partiellement payée");
  // 1 200 invoice, 200 paid AT THE SALE -> only 1 000 on credit (never deducted twice)
  await makeSale(tx, org, partial.id, { status: "PARTIALLY_PAID", total: 1200, credit: 1000 });

  const settled = await makeCustomer(tx, org, "C - règlements");
  await makeSale(tx, org, settled.id, { total: 800 });
  await makeSettlement(tx, org, settled.id, { amount: 300 });
  await makeSettlement(tx, org, settled.id, { amount: 999, status: "CANCELLED" });

  const notes = await makeCustomer(tx, org, "D - avoirs");
  const notesSale = await makeSale(tx, org, notes.id, { total: 600 });
  await makeCreditNote(tx, org, notes.id, { total: 100, refundMethod: "CASH", originalSaleId: notesSale.id });
  await makeCreditNote(tx, org, notes.id, { total: 50, refundMethod: "BANK" });
  await makeCreditNote(tx, org, notes.id, { total: 70, status: "DRAFT" });
  await makeCreditNote(tx, org, notes.id, { total: 80, status: "REVERSED" });
  await makeCreditNote(tx, org, notes.id, { total: 500, partyType: "SUPPLIER" });

  const ignored = await makeCustomer(tx, org, "E - ventes non comptées");
  await makeSale(tx, org, ignored.id, { status: "DRAFT", total: 400, credit: 0 });
  await makeSale(tx, org, ignored.id, { status: "CANCELLED", total: 900 });
  await makeSale(tx, org, ignored.id, { status: "PAID", total: 300, credit: 0 });

  const creditor = await makeCustomer(tx, org, "F - solde créditeur");
  await makeSale(tx, org, creditor.id, { total: 100 });
  await makeCreditNote(tx, org, creditor.id, { total: 130, refundMethod: "CASH" });

  const cashOnly = await makeCustomer(tx, org, "G - avoir espèces sur vente comptant");
  const cashSale = await makeSale(tx, org, cashOnly.id, { status: "PAID", total: 200, credit: 0 });
  await makeCreditNote(tx, org, cashOnly.id, { total: 40, refundMethod: "CASH", originalSaleId: cashSale.id });

  const nothing = await makeCustomer(tx, org, "H - aucun mouvement");

  return { plain, partial, settled, notes, ignored, creditor, cashOnly, nothing };
}

test("the grouped balances equal computeCustomerDebt for EVERY customer (sales, credit notes, settlements of every status)", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "equiv");
    const customers = await seedMixedOrg(tx, org);
    const balances = await loadCustomerBalances(tx, org.organization.id);
    for (const [label, customer] of Object.entries(customers)) {
      const reference = await computeCustomerDebt(tx, org.organization.id, customer.id);
      const grouped = balances.get(customer.id);
      assert.deepEqual(
        {
          creditSalesTotal: grouped?.creditSalesTotal ?? 0,
          creditNotesTotal: grouped?.creditNotesTotal ?? 0,
          settlementsTotal: grouped?.settlementsTotal ?? 0,
          debt: grouped?.debt ?? 0,
        },
        {
          creditSalesTotal: reference.creditSalesTotal,
          creditNotesTotal: reference.creditNotesTotal,
          settlementsTotal: reference.settlementsTotal,
          debt: reference.debt,
        },
        label,
      );
    }
    // the expected figures themselves
    const debt = (id: string) => balances.get(id)?.debt ?? 0;
    assert.equal(debt(customers.plain.id), 1000);
    assert.equal(debt(customers.partial.id), 1000, "the 200 paid at the sale is not deducted twice");
    assert.equal(debt(customers.settled.id), 500, "the cancelled settlement does not count");
    assert.equal(debt(customers.notes.id), 450, "only VALIDATED customer notes (CASH and BANK) count: 600 - 100 - 50");
    assert.equal(debt(customers.ignored.id), 0, "draft, cancelled and paid sales do not count");
    assert.equal(balances.get(customers.creditor.id)?.raw, -30);
    assert.equal(debt(customers.creditor.id), 0);
    assert.equal(balances.get(customers.cashOnly.id)?.raw, -40, "a cash note on a cash sale gives a negative raw balance under the current rule");
    assert.equal(balances.get(customers.notes.id)?.cashCreditNotesTotal, 100);
  });
});

test("overview: the total equals Σ computeCustomerDebt, credit balances are shown apart and never netted", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "total");
    const customers = await seedMixedOrg(tx, org);
    const all = await tx.customer.findMany({ where: { organizationId: org.organization.id }, select: { id: true } });
    let reference = 0;
    for (const customer of all) reference += (await computeCustomerDebt(tx, org.organization.id, customer.id)).debt;

    const overview = await loadReceivablesOverview(tx, org.organization.id, { now: NOW, settings: SETTINGS });
    assert.equal(overview.totals.totalOutstanding, Math.round(reference * 100) / 100);
    assert.equal(overview.totals.totalOutstanding, 2950); // 1000 + 1000 + 500 + 450
    assert.equal(overview.totals.debtorCount, 4);
    assert.deepEqual(overview.debtors.map((row) => row.name).sort(), ["A - crédit simple", "B - partiellement payée", "C - règlements", "D - avoirs"]);
    for (const row of overview.debtors) {
      assert.equal(row.balance, (await computeCustomerDebt(tx, org.organization.id, row.customerId)).debt, row.name);
      assert.equal(Math.round((row.buckets["0-30"] + row.buckets["31-60"] + row.buckets["61-90"] + row.buckets["90+"]) * 100), Math.round(row.balance * 100), `${row.name}: buckets = balance`);
    }
    assert.equal(overview.creditors.count, 2);
    assert.equal(overview.creditors.total, 70);
    const creditor = overview.creditors.rows.find((row) => row.customerId === customers.creditor.id)!;
    assert.deepEqual([creditor.creditBalance, creditor.cashCreditNotesTotal, creditor.explainedByCashCreditNotes], [30, 130, true]);
    assert.deepEqual(overview.dataNotes.cashCreditNotes, { count: 3, total: 270 });
    assert.equal(overview.dataNotes.agingMismatchCount, 0);
    // buckets add up to the total
    assert.equal(Math.round(overview.buckets.reduce((sum, bucket) => sum + bucket.amount, 0) * 100), 295000);
  });
});

test("FIFO aging: a partial settlement pays the oldest sale first; soldAt dates an offline driver sale; buckets and thresholds", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "fifo");
    const customer = await makeCustomer(tx, org, "Client FIFO");
    await makeSale(tx, org, customer.id, { total: 1000, at: daysAgo(100) }); // oldest - 90+
    await makeSale(tx, org, customer.id, { total: 500, at: daysAgo(45) }); // 31-60
    // validated (synced) 2 days ago, but SOLD 70 days ago offline -> 61-90
    await makeSale(tx, org, customer.id, { total: 300, at: daysAgo(2), soldAt: daysAgo(70) });
    await makeSale(tx, org, customer.id, { total: 200, at: daysAgo(10) }); // 0-30
    await makeSettlement(tx, org, customer.id, { amount: 1200 });

    const overview = await loadReceivablesOverview(tx, org.organization.id, { now: NOW, settings: SETTINGS });
    const row = overview.debtors[0];
    // FIFO order by sale date: 100 d (1000), 70 d (300, soldAt), 45 d (500), 10 d (200) - total 2000.
    // The 1200 settled pays the 100-day sale and 200 of the 70-day one -> open: 70 d 100, 45 d 500, 10 d 200 = 800.
    assert.equal(row.balance, 800);
    assert.deepEqual(row.buckets, { "0-30": 200, "31-60": 500, "61-90": 100, "90+": 0 });
    assert.equal(row.over30, 600);
    assert.equal(row.overdue, 600);
    assert.equal(row.oldestOpenAgeDays, 70);
    assert.equal(row.lastSettlementDay, "2026-06-10");

    const short = await loadReceivablesOverview(tx, org.organization.id, { now: NOW, settings: { overdueDays: 7, isDefault: false } });
    assert.equal(short.debtors[0].overdue, 800, "everything older than 7 days is overdue");
    assert.equal(short.debtors[0].over30, 600, "the 30-day indicator does not depend on the delay");
    const long = await loadReceivablesOverview(tx, org.organization.id, { now: NOW, settings: { overdueDays: 60, isDefault: false } });
    assert.equal(long.debtors[0].overdue, 100);
    assert.equal(long.totals.overdue, 100);
  });
});

test("detail: movements of the formula with a running balance ending exactly on the table's balance; CASH notes flagged; exclusions counted", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "detail");
    const customer = await makeCustomer(tx, org, "Client détail");
    const sale = await makeSale(tx, org, customer.id, { status: "PARTIALLY_PAID", total: 1200, credit: 1000, at: daysAgo(40) });
    await makeSale(tx, org, customer.id, { total: 400, at: daysAgo(5) });
    await makeCreditNote(tx, org, customer.id, { total: 100, refundMethod: "CASH", originalSaleId: sale.id, at: daysAgo(20) });
    await makeCreditNote(tx, org, customer.id, { total: 60, status: "DRAFT" });
    await makeCreditNote(tx, org, customer.id, { total: 60, status: "REVERSED" });
    await makeSettlement(tx, org, customer.id, { amount: 250, day: "2026-06-12" });
    await makeSettlement(tx, org, customer.id, { amount: 777, status: "CANCELLED" });
    await makeSale(tx, org, customer.id, { status: "CANCELLED", total: 900 });

    const detail = await loadCustomerReceivableDetail(tx, org.organization.id, customer.id, { now: NOW, settings: SETTINGS });
    const reference = await computeCustomerDebt(tx, org.organization.id, customer.id);
    assert.equal(detail.debt.debt, reference.debt);
    assert.equal(detail.debt.debt, 1050); // 1000 + 400 - 100 - 250
    assert.equal(detail.reconciled, true);
    assert.equal(detail.movements.at(-1)!.balance, 1050);
    assert.deepEqual(detail.movements.map((m) => m.kind), ["CREDIT_SALE", "CREDIT_NOTE", "CREDIT_SALE", "SETTLEMENT"]);
    const note = detail.movements.find((m) => m.kind === "CREDIT_NOTE")!;
    assert.equal(note.creditNote?.refundMethod, "CASH");
    assert.equal(note.creditNote?.originalSaleStatus, "PARTIALLY_PAID");
    assert.deepEqual(detail.cashCreditNotes, { count: 1, total: 100 });
    const firstSale = detail.movements[0];
    assert.deepEqual([firstSale.amount, firstSale.sale?.totalTTC, firstSale.sale?.paidAtSale], [1000, 1200, 200]);
    assert.deepEqual(detail.excluded, { draftOrCancelledSales: 1, nonValidatedCreditNotes: 2, cancelledSettlements: 1 });
    // FIFO: 350 of reductions pay the 40-day sale first -> open 650 (40 d) + 400 (5 d)
    assert.deepEqual(detail.aging.buckets, { "0-30": 400, "31-60": 650, "61-90": 0, "90+": 0 });
    // the table row of this customer carries the same aging
    const overview = await loadReceivablesOverview(tx, org.organization.id, { now: NOW, settings: SETTINGS });
    assert.deepEqual(overview.debtors[0].buckets, detail.aging.buckets);
    assert.equal(overview.debtors[0].overdue, detail.aging.overdue);
  });
});

test("detail of a credit-balance customer and of a customer with nothing: no misleading figure", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "edge");
    const customers = await seedMixedOrg(tx, org);
    const creditor = await loadCustomerReceivableDetail(tx, org.organization.id, customers.creditor.id, { now: NOW, settings: SETTINGS });
    assert.deepEqual([creditor.debt.debt, creditor.rawBalance, creditor.reconciled], [0, -30, true]);
    assert.equal(creditor.movements.at(-1)!.balance, -30);
    const empty = await loadCustomerReceivableDetail(tx, org.organization.id, customers.nothing.id, { now: NOW, settings: SETTINGS });
    assert.deepEqual([empty.debt.debt, empty.rawBalance, empty.movements.length, empty.reconciled], [0, 0, 0, true]);
  });
});

test("organisation isolation: another organisation's customers and documents never appear and its customer is a 404", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const mine = await makeOrg(tx, "mine");
    const other = await makeOrg(tx, "other");
    const myCustomer = await makeCustomer(tx, mine, "Mon client");
    await makeSale(tx, mine, myCustomer.id, { total: 100 });
    const theirCustomer = await makeCustomer(tx, other, "Leur client");
    await makeSale(tx, other, theirCustomer.id, { total: 99_999 });
    await makeCreditNote(tx, other, theirCustomer.id, { total: 5 });

    const overview = await loadReceivablesOverview(tx, mine.organization.id, { now: NOW, settings: SETTINGS });
    assert.equal(overview.totals.totalOutstanding, 100);
    assert.deepEqual(overview.debtors.map((row) => row.customerId), [myCustomer.id]);
    assert.equal(overview.dataNotes.cashCreditNotes.count, 0);
    assert.equal((await loadCustomerBalances(tx, mine.organization.id)).has(theirCustomer.id), false);

    await assert.rejects(
      loadCustomerReceivableDetail(tx, mine.organization.id, theirCustomer.id, { now: NOW, settings: SETTINGS }),
      (error: unknown) => error instanceof ReceivablesError && error.status === 404,
    );
  });
});

test("empty organisation: zeros, no debtor, no creditor", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "empty");
    const overview = await loadReceivablesOverview(tx, org.organization.id, { now: NOW, settings: SETTINGS });
    assert.deepEqual(overview.totals, { totalOutstanding: 0, debtorCount: 0, overdue: 0, over30: 0 });
    assert.deepEqual(overview.debtors, []);
    assert.equal(overview.creditors.count, 0);
    assert.ok(overview.buckets.every((bucket) => bucket.amount === 0 && bucket.customerCount === 0));
  });
});

test("the overdue delay is stored per organisation, next to the other settings, and audited", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "settings");
    const other = await makeOrg(tx, "settings-other");
    await tx.organization.update({
      where: { id: org.organization.id },
      data: { productColumnSettings: { columns: { brand: false }, labels: { sales: { orders: { reference: "N°" } } } } },
    });
    assert.deepEqual(await readReceivablesSettings(tx, org.organization.id), { overdueDays: 30, isDefault: true });

    await writeReceivablesSettings(tx, org.organization.id, org.admin.id, 45);
    assert.deepEqual(await readReceivablesSettings(tx, org.organization.id), { overdueDays: 45, isDefault: false });
    assert.deepEqual(await readReceivablesSettings(tx, other.organization.id), { overdueDays: 30, isDefault: true }, "other organisation untouched");
    const stored = (await tx.organization.findUnique({ where: { id: org.organization.id }, select: { productColumnSettings: true } }))!.productColumnSettings;
    assert.deepEqual(stored, { columns: { brand: false }, labels: { sales: { orders: { reference: "N°" } } }, receivables: { overdueDays: 45 } });
    const audit = await tx.auditLog.findFirst({ where: { organizationId: org.organization.id, action: "RECEIVABLES_OVERDUE_DAYS_UPDATED" } });
    assert.deepEqual([audit?.userId, audit?.newValue], [org.admin.id, { overdueDays: 45 }]);
  });
});

// ---------------------------------------------------------------------------
// Permissions and wiring (source level, like the other role-gating tests)
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("every entry point is admin-only ON THE SERVER, with the organisation of the session", () => {
  const server = code("./receivables.ts");
  assert.match(code("../receivables/access.ts"), /RECEIVABLES_VIEW_ROLES: UserRole\[\] = \["admin"\];/);
  assert.match(server, /^import "server-only";/);
  assert.match(server, /export const RECEIVABLES_ROLES = RECEIVABLES_VIEW_ROLES;/);
  for (const fn of ["getReceivablesOverview", "getCustomerReceivableDetail", "updateReceivablesSettings"]) {
    assert.match(server, new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s+const user = await requireOrganizationUser\\(\\[\\.\\.\\.RECEIVABLES_ROLES\\]\\);`), fn);
  }
  assert.equal((server.match(/requireOrganizationUser\(/g) ?? []).length, 3, "no unguarded entry point");
  assert.equal((server.match(/user\.organizationId/g) ?? []).length >= 3, true);
  // the core decides nothing about access and writes nothing but the settings
  const core = code("./receivables-core.ts");
  assert.equal(/requireOrganizationUser|@\/lib\/prisma"|server-only/.test(core), false);
  const writes = core.match(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/g) ?? [];
  assert.deepEqual(writes, [".update(", ".create("], "only writeReceivablesSettings writes (organization.update + auditLog.create)");
  assert.match(core, /export async function writeReceivablesSettings[\s\S]*db\.organization\.update[\s\S]*db\.auditLog\.create/);
});

test("the API routes call only the guarded functions and answer 401/403/404/422 without leaking", () => {
  const overview = code("../../app/api/dashboard/receivables/route.ts");
  const detail = code("../../app/api/dashboard/receivables/customers/[id]/route.ts");
  const settings = code("../../app/api/dashboard/receivables/settings/route.ts");
  assert.match(overview, /getReceivablesOverview\(\)/);
  assert.match(detail, /getCustomerReceivableDetail\(id\)/);
  assert.match(settings, /updateReceivablesSettings\(body\)/);
  assert.match(settings, /rejectUntrustedOrigin\(request\)/);
  for (const route of [overview, detail, settings]) {
    assert.match(route, /AuthServiceError/);
    assert.equal(/prisma|\$queryRaw|organizationId/.test(route), false, "no query and no organisation from the request");
  }
  assert.equal(/export async function (POST|PUT|PATCH|DELETE)/.test(overview + detail), false, "overview and detail are read only");
});

test("the Dashboard renders the section for the admin only; it has no write action besides the delay", () => {
  const page = code("../../app/(dashboard)/dashboard/page.tsx");
  assert.match(page, /const showReceivables = canViewReceivables\(sessionUser\?\.role\);/);
  assert.match(page, /\{showReceivables \? <ReceivablesSection \/> : null\}/);
  const ui = ["receivables-section.tsx", "receivables-debtors-table.tsx", "receivables-customer-detail.tsx", "receivables-aging-chart.tsx"]
    .map((file) => code(`../../components/dashboard/receivables/${file}`))
    .join("\n");
  assert.equal(/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(ui), false, "no settlement, cancellation or accounting action");
  assert.match(code("../../components/dashboard/receivables/overdue-days-setting.tsx"), /\/api\/dashboard\/receivables\/settings/);
});

test("computeCustomerDebt is unchanged and still the one every existing caller uses", () => {
  const settlements = code("./customer-settlements.ts");
  assert.match(settlements, /import \{ computeCustomerDebt \} from "@\/lib\/server\/customer-debt";/);
  assert.match(settlements, /export \{ computeCustomerDebt \};/);
  assert.equal(/async function computeCustomerDebt/.test(settlements), false, "one definition only");
  const debt = code("./customer-debt.ts");
  assert.match(debt, /status: \{ in: \["CREDIT", "PARTIALLY_PAID"\] \}/);
  assert.match(debt, /partyType: "CUSTOMER",\s+status: "VALIDATED"/);
  assert.match(debt, /where: \{ organizationId, customerId, status: "VALIDATED" \}/);
  assert.match(debt, /const debt = Math\.max\(0, roundMoney\(creditSalesTotal - creditNotesTotal - settlementsTotal\)\);/);
});
