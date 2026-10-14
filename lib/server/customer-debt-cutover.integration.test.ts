import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Lot 2 - the debt rule against a THROWAWAY PostgreSQL database: the REAL computeCustomerDebt,
 * the REAL grouped loadCustomerBalances, the REAL receivables overview and customer detail
 * (movements, running balance, FIFO aging). The cutover is passed explicitly (the shared
 * constant stays null); the flows that read the constant itself are in
 * customer-debt-cutover.flows.integration.test.ts.
 *
 * Safety: the file does nothing unless D2_TEST_DATABASE_URL names the local database
 * `commdis_d2_test` AND DATABASE_URL is that very URL (use the wrapper).
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
const SKIP = enabled ? false : "D2_TEST_DATABASE_URL is not the throwaway database commdis_d2_test (use the wrapper)";

let prisma: PrismaClient;
let debt: typeof import("@/lib/server/customer-debt");
let core: typeof import("@/lib/server/receivables-core");

before(async () => {
  if (!enabled) return;
  prisma = (await import("@/lib/prisma")).prisma;
  debt = await import("@/lib/server/customer-debt");
  core = await import("@/lib/server/receivables-core");
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (enabled) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);
const T = new Date("2026-11-02T08:30:00.000Z"); // an ARBITRARY test cutover - not a real date
const NOW = new Date("2026-11-10T12:00:00.000Z");
const SETTINGS = { overdueDays: 30, isDefault: true };
const at = (offsetMs: number) => new Date(T.getTime() + offsetMs);
const DAY = 86_400_000;

// ---- fixtures -----------------------------------------------------------------------------------------

async function makeOrg(label: string) {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `CUT-${label}-${suffix}`.toUpperCase(), name: `Cutover ${label}` } });
  const admin = await prisma.user.create({
    data: { organizationId: organization.id, firstName: "A", lastName: label, fullName: `Admin ${label}`, email: `cut-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await prisma.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id } });
  const supplier = await prisma.supplier.create({ data: { organizationId: organization.id, code: `S-${suffix}`, name: "Fournisseur" } });
  return { id: organization.id, adminId: admin.id, locationId: location.id, supplierId: supplier.id };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

async function customer(org: Org, name: string) {
  const row = await prisma.customer.create({
    data: { organizationId: org.id, code: `C-${uid()}`, name, address: "-", city: "-", type: "GROCERY", createdByUserId: org.adminId, creationOrigin: "ADMIN" },
  });
  return row.id;
}

async function creditSale(org: Org, customerId: string, amount: number, when: Date, status: "CREDIT" | "PARTIALLY_PAID" = "CREDIT") {
  return prisma.sale.create({
    data: {
      organizationId: org.id,
      invoiceNumber: `INV-${uid()}`,
      origin: "COUNTER",
      status,
      stockLocationId: org.locationId,
      customerId,
      subtotalHT: amount,
      taxAmount: 0,
      totalTTC: amount,
      paidAmount: 0,
      creditAmount: amount,
      paymentMethod: "CREDIT",
      createdByUserId: org.adminId,
      validatedAt: when,
      soldAt: when,
    },
  });
}

type NoteSpec = {
  refund: "CASH" | "BANK";
  total: number;
  validatedAt: Date | null;
  status?: "DRAFT" | "VALIDATED" | "REVERSED";
  party?: "CUSTOMER" | "SUPPLIER";
};
async function note(org: Org, customerId: string, spec: NoteSpec) {
  return prisma.creditNote.create({
    data: {
      organizationId: org.id,
      creditNoteNumber: `AVC-${uid()}`,
      partyType: spec.party ?? "CUSTOMER",
      customerId,
      supplierId: spec.party === "SUPPLIER" ? org.supplierId : null,
      status: spec.status ?? "VALIDATED",
      origin: "MANUAL",
      refundMethod: spec.refund,
      reason: "OTHER",
      subtotalHT: spec.total,
      taxAmount: 0,
      totalTTC: spec.total,
      createdByUserId: org.adminId,
      validatedAt: spec.validatedAt,
    },
  });
}

async function settlement(org: Org, customerId: string, amount: number, day: string, status: "VALIDATED" | "CANCELLED" = "VALIDATED") {
  return prisma.customerSettlement.create({
    data: {
      organizationId: org.id,
      settlementNumber: `REG-${uid()}`,
      customerId,
      date: new Date(`${day}T00:00:00Z`),
      amount,
      method: "CASH",
      status,
      createdByUserId: org.adminId,
    },
  });
}

/** The two computations side by side for one customer - they must be the same figures. */
async function both(org: Org, customerId: string, cutover: Date | null) {
  const single = await debt.computeCustomerDebt(prisma, org.id, customerId, { cutover });
  const grouped = (await core.loadCustomerBalances(prisma, org.id, { cutover })).get(customerId);
  return { single, grouped };
}

function assertParity(single: Awaited<ReturnType<typeof debt.computeCustomerDebt>>, grouped: Awaited<ReturnType<typeof core.loadCustomerBalances>> extends Map<string, infer V> ? V | undefined : never, label: string) {
  if (!grouped) {
    assert.equal(single.creditSalesTotal + single.creditNotesTotal + single.settlementsTotal, 0, `${label}: absent from the grouped map only when there is nothing`);
    assert.equal(single.debt, 0, label);
    return;
  }
  assert.equal(grouped.creditSalesTotal, single.creditSalesTotal, `${label}: credit sales`);
  assert.equal(grouped.creditNotesTotal, single.creditNotesTotal, `${label}: credit notes`);
  assert.equal(grouped.settlementsTotal, single.settlementsTotal, `${label}: settlements`);
  assert.equal(grouped.debt, single.debt, `${label}: debt`);
  assert.equal(grouped.raw, Math.round((single.creditSalesTotal - single.creditNotesTotal - single.settlementsTotal) * 100) / 100, `${label}: raw`);
  assert.equal(grouped.cashRefundsNotDeductedTotal, single.cashRefundsNotDeductedTotal ?? 0, `${label}: refunds left out`);
}

// ---- 1. dormant ---------------------------------------------------------------------------------------------

test("DORMANT (cutover null): every validated customer note reduces the debt, exactly as before - same result shape, same figures in both computations", { skip: SKIP }, async () => {
  const org = await makeOrg("dormant");
  const c = await customer(org, "Client dormant");
  await creditSale(org, c, 500, new Date("2026-10-01T10:00:00Z"));
  await note(org, c, { refund: "CASH", total: 100, validatedAt: at(5 * DAY) });
  await note(org, c, { refund: "BANK", total: 40, validatedAt: at(6 * DAY) });

  for (const cutover of [null, undefined]) {
    const single = await debt.computeCustomerDebt(prisma, org.id, c, cutover === undefined ? undefined : { cutover });
    assert.deepEqual(single, { customerId: c, creditSalesTotal: 500, creditNotesTotal: 140, settlementsTotal: 0, debt: 360 }, "no extra field while dormant");
  }
  const grouped = (await core.loadCustomerBalances(prisma, org.id)).get(c)!;
  assert.equal(grouped.debt, 360);
  assert.equal(grouped.cashCreditNotesTotal, 100, "the cash note is still counted AND flagged, as before");
  assert.equal(grouped.cashRefundsNotDeductedTotal, 0);
});

// ---- 2. the rule, case by case -------------------------------------------------------------------------------

test("ACTIVE cutover: 500 owed - a cash refund of 100 validated AFTER leaves the debt at 500; an account credit takes it to 400; a cash refund validated BEFORE keeps its historical effect (400)", { skip: SKIP }, async () => {
  const org = await makeOrg("rule");
  const cases: Array<[string, NoteSpec, number, number]> = [
    // label, note, expected debt, expected refunds left out
    ["cash after", { refund: "CASH", total: 100, validatedAt: at(5 * DAY) }, 500, 100],
    ["bank after", { refund: "BANK", total: 100, validatedAt: at(5 * DAY) }, 400, 0],
    ["cash before (historical)", { refund: "CASH", total: 100, validatedAt: at(-5 * DAY) }, 400, 0],
    ["bank before (historical)", { refund: "BANK", total: 100, validatedAt: at(-5 * DAY) }, 400, 0],
    ["cash 1 ms before", { refund: "CASH", total: 100, validatedAt: at(-1) }, 400, 0],
    ["cash EXACTLY at the cutover", { refund: "CASH", total: 100, validatedAt: at(0) }, 500, 100],
    ["cash 1 ms after", { refund: "CASH", total: 100, validatedAt: at(1) }, 500, 100],
    ["cash with NO validation date", { refund: "CASH", total: 100, validatedAt: null }, 400, 0],
    ["bank with NO validation date", { refund: "BANK", total: 100, validatedAt: null }, 400, 0],
  ];
  for (const [label, spec, expectedDebt, expectedLeftOut] of cases) {
    const c = await customer(org, label);
    await creditSale(org, c, 500, new Date("2026-10-01T10:00:00Z"));
    await note(org, c, spec);
    const { single, grouped } = await both(org, c, T);
    assert.equal(single.debt, expectedDebt, `${label}: computeCustomerDebt`);
    assert.equal(single.cashRefundsNotDeductedTotal, expectedLeftOut, `${label}: refunds left out`);
    assertParity(single, grouped, label);
    // and the SAME customer with the rule dormant: always the historical 400
    assert.equal((await debt.computeCustomerDebt(prisma, org.id, c, { cutover: null })).debt, 400, `${label}: dormant`);
  }
});

test("ACTIVE cutover: reversed and draft notes stay out, supplier-type notes stay out, cancelled settlements stay out - and a mix adds up", { skip: SKIP }, async () => {
  const org = await makeOrg("mix");
  const c = await customer(org, "Client mixte");
  await creditSale(org, c, 500, new Date("2026-10-01T10:00:00Z"));
  await note(org, c, { refund: "CASH", total: 30, validatedAt: at(-3 * DAY) }); // historical cash: counts
  await note(org, c, { refund: "CASH", total: 100, validatedAt: at(3 * DAY) }); // new cash: left out
  await note(org, c, { refund: "BANK", total: 50, validatedAt: at(4 * DAY) }); // account credit: counts
  await note(org, c, { refund: "BANK", total: 999, validatedAt: at(4 * DAY), status: "REVERSED" });
  await note(org, c, { refund: "CASH", total: 999, validatedAt: null, status: "DRAFT" });
  await note(org, c, { refund: "BANK", total: 999, validatedAt: at(-3 * DAY), party: "SUPPLIER" });
  await settlement(org, c, 999, "2026-11-05", "CANCELLED");

  const { single, grouped } = await both(org, c, T);
  assert.equal(single.creditNotesTotal, 80, "30 historical + 50 account");
  assert.equal(single.cashRefundsNotDeductedTotal, 100);
  assert.equal(single.debt, 420);
  assertParity(single, grouped, "mix");
  assert.equal(grouped!.cashCreditNotesTotal, 30, "only the historical cash note is still « counted cash »");
  assert.equal(grouped!.cashCreditNotesCount, 1);
  assert.equal(grouped!.cashRefundsNotDeductedCount, 1);
  // dormant: the new cash note counts again (not reversed / draft / supplier ones, never)
  assert.equal((await debt.computeCustomerDebt(prisma, org.id, c, { cutover: null })).debt, 500 - 30 - 100 - 50);
});

// ---- 3. no historical balance moves ----------------------------------------------------------------------------

test("ACTIVATING the cutover after the last historical note changes NO balance - every customer, both computations, the whole overview", { skip: SKIP }, async () => {
  const org = await makeOrg("history");
  const ids: string[] = [];
  const specs: Array<[number, NoteSpec[], number]> = [
    [1020.01, [{ refund: "CASH", total: 1312.48, validatedAt: new Date("2026-10-13T14:57:35.233Z") }], 0], // a credit balance, like production's
    [3641.69, [{ refund: "CASH", total: 107.99, validatedAt: new Date("2026-08-15T12:19:29Z") }], 0],
    [800, [{ refund: "BANK", total: 200, validatedAt: new Date("2026-09-20T09:00:00Z") }, { refund: "CASH", total: 60, validatedAt: new Date("2026-10-04T13:03:39Z") }], 150],
    [250, [], 0],
  ];
  for (const [sales, notes, settled] of specs) {
    const c = await customer(org, `H${ids.length}`);
    ids.push(c);
    await creditSale(org, c, sales, new Date("2026-07-01T10:00:00Z"));
    for (const spec of notes) await note(org, c, spec);
    if (settled) await settlement(org, c, settled, "2026-10-10");
  }
  const cutover = new Date("2026-10-14T00:00:00Z"); // after every note above
  for (const c of ids) {
    const before = await both(org, c, null);
    const after = await both(org, c, cutover);
    const { cashRefundsNotDeductedTotal, ...afterFigures } = after.single;
    assert.equal(cashRefundsNotDeductedTotal, 0, "nothing left out");
    assert.deepEqual(afterFigures, before.single, "the figures of a customer are identical before and after the activation");
    assert.equal(after.grouped?.debt, before.grouped?.debt);
    assert.equal(after.grouped?.raw, before.grouped?.raw);
  }
  const dormantView = await core.loadReceivablesOverview(prisma, org.id, { now: NOW, settings: SETTINGS, cutover: null });
  const activeView = await core.loadReceivablesOverview(prisma, org.id, { now: NOW, settings: SETTINGS, cutover });
  assert.deepEqual(activeView.totals, dormantView.totals);
  assert.deepEqual(activeView.buckets, dormantView.buckets);
  assert.deepEqual(activeView.debtors, dormantView.debtors);
  assert.deepEqual(activeView.creditors, dormantView.creditors);
  assert.deepEqual(activeView.dataNotes.cashCreditNotes, dormantView.dataNotes.cashCreditNotes, "the historical cash notes are still counted and flagged");
  assert.equal(dormantView.dataNotes.cashRefundsNotDeducted, undefined, "dormant: the new field is absent");
  assert.deepEqual(activeView.dataNotes.cashRefundsNotDeducted, { count: 0, total: 0 });
});

// ---- 4. parity over a rich dataset ----------------------------------------------------------------------------------

test("PARITY: computeCustomerDebt and loadCustomerBalances give the same figures for every customer, dormant and active", { skip: SKIP }, async () => {
  const org = await makeOrg("parity");
  const ids: string[] = [];
  const plans: NoteSpec[][] = [
    [],
    [{ refund: "CASH", total: 10, validatedAt: at(-DAY) }],
    [{ refund: "CASH", total: 10, validatedAt: at(DAY) }],
    [{ refund: "BANK", total: 10, validatedAt: at(DAY) }, { refund: "CASH", total: 20, validatedAt: at(DAY) }, { refund: "CASH", total: 5, validatedAt: at(-DAY) }],
    [{ refund: "CASH", total: 700, validatedAt: at(DAY) }], // exceeds nothing, left out
    [{ refund: "CASH", total: 700, validatedAt: at(-DAY) }], // exceeds the sales: a credit balance
    [{ refund: "CASH", total: 10, validatedAt: null }, { refund: "BANK", total: 10, validatedAt: null, status: "REVERSED" }],
  ];
  for (const plan of plans) {
    const c = await customer(org, `P${ids.length}`);
    ids.push(c);
    await creditSale(org, c, 300, new Date("2026-10-01T10:00:00Z"));
    await creditSale(org, c, 120, new Date("2026-10-15T10:00:00Z"), "PARTIALLY_PAID");
    for (const spec of plan) await note(org, c, spec);
    if (ids.length % 2 === 0) await settlement(org, c, 25, "2026-11-04");
  }
  for (const cutover of [null, T]) {
    const grouped = await core.loadCustomerBalances(prisma, org.id, { cutover });
    for (const [index, c] of ids.entries()) {
      assertParity(await debt.computeCustomerDebt(prisma, org.id, c, { cutover }), grouped.get(c), `customer ${index} / cutover ${cutover ? "T" : "null"}`);
    }
  }
});

// ---- 5. the receivables detail: movements, running balance, FIFO aging ---------------------------------------------

async function detailFixture(label: string) {
  const org = await makeOrg(label);
  const c = await customer(org, "Client detail");
  await creditSale(org, c, 200, new Date("2026-09-01T10:00:00Z")); // S1, the oldest
  await creditSale(org, c, 300, new Date("2026-10-20T10:00:00Z")); // S2
  await note(org, c, { refund: "CASH", total: 50, validatedAt: new Date("2026-10-20T10:00:00Z") }); // historical cash
  await note(org, c, { refund: "CASH", total: 100, validatedAt: new Date("2026-11-03T10:00:00Z") }); // new cash
  await note(org, c, { refund: "BANK", total: 40, validatedAt: new Date("2026-11-04T10:00:00Z") }); // new account credit
  await settlement(org, c, 30, "2026-11-05");
  return { org, c };
}

test("DETAIL (active): the new cash refund is listed with an effect of 0, the running balance reconciles with the debt, the FIFO aging is built on the debt", { skip: SKIP }, async () => {
  const { org, c } = await detailFixture("detail-active");
  const detail = await core.loadCustomerReceivableDetail(prisma, org.id, c, { now: NOW, settings: SETTINGS, cutover: T });

  assert.equal(detail.debt.debt, 380, "500 - 50 (historical cash) - 40 (account) - 30 (settlement)");
  assert.equal(detail.debt.creditNotesTotal, 90);
  assert.equal(detail.rawBalance, 380);
  assert.equal(detail.reconciled, true, "the last running balance equals the debt formula");
  assert.equal(detail.movements.at(-1)!.balance, 380);

  const notes = detail.movements.filter((movement) => movement.kind === "CREDIT_NOTE");
  assert.equal(notes.length, 3);
  const newCash = notes.find((movement) => movement.creditNote?.notDeductedFromDebt)!;
  assert.equal(newCash.amount, 0, "no effect on the balance");
  assert.equal(newCash.creditNote!.notDeductedFromDebt!.faceAmount, 100);
  assert.match(newCash.label, /^Remboursement espèces /);
  const historical = notes.find((movement) => movement.amount === -50)!;
  assert.equal(historical.creditNote!.refundMethod, "CASH");
  assert.equal(historical.creditNote!.notDeductedFromDebt, undefined, "a historical cash note is deducted, as before");
  assert.equal(notes.find((movement) => movement.amount === -40)!.creditNote!.refundMethod, "BANK");

  assert.deepEqual(detail.cashCreditNotes, { count: 1, total: 50 }, "only the historical cash note is counted cash");
  assert.deepEqual(detail.cashRefundsNotDeducted, { count: 1, total: 100 });

  // FIFO: the 380 of debt sits on the NEWEST sales first: S2 (300, 21 days old) fully, S1 (200) for 80 (70 days old)
  assert.equal(detail.aging.buckets["0-30"], 300);
  assert.equal(detail.aging.buckets["61-90"], 80);
  assert.equal(detail.aging.buckets["31-60"] + detail.aging.buckets["90+"], 0);
  assert.equal(detail.aging.over30, 80);
  const openTotal = Object.values(detail.aging.buckets).reduce((sum, value) => sum + value, 0);
  assert.equal(openTotal, detail.debt.debt, "the aged parts add up to the debt");
  const sales = detail.movements.filter((movement) => movement.kind === "CREDIT_SALE");
  assert.equal(sales.reduce((sum, movement) => sum + movement.sale!.openEstimate, 0), 380);
});

test("DETAIL (dormant): the same data under the historical rule - every note deducted, no new field, the same reconciliation", { skip: SKIP }, async () => {
  const { org, c } = await detailFixture("detail-dormant");
  const detail = await core.loadCustomerReceivableDetail(prisma, org.id, c, { now: NOW, settings: SETTINGS, cutover: null });
  assert.equal(detail.debt.debt, 280, "500 - 50 - 100 - 40 - 30");
  assert.equal(detail.reconciled, true);
  assert.equal(detail.cashRefundsNotDeducted, undefined);
  assert.equal((detail.debt as Record<string, unknown>).cashRefundsNotDeductedTotal, undefined, "the detail's debt block keeps its four historical fields");
  assert.deepEqual(detail.cashCreditNotes, { count: 2, total: 150 }, "both cash notes are counted, as before");
  for (const movement of detail.movements.filter((item) => item.kind === "CREDIT_NOTE")) {
    assert.equal(movement.creditNote!.notDeductedFromDebt, undefined);
    assert.ok(movement.amount < 0);
    assert.match(movement.label, /^Avoir /);
  }
  // FIFO on 280: S2 for 280 (21 days); S1 fully paid
  assert.equal(detail.aging.buckets["0-30"], 280);
  assert.equal(detail.aging.over30, 0);
});

test("OVERVIEW (active): balances, aging, creditors and the data notes follow the rule; a new cash refund no longer creates a credit balance", { skip: SKIP }, async () => {
  const org = await makeOrg("overview");
  const debtor = await customer(org, "Debiteur");
  await creditSale(org, debtor, 500, new Date("2026-10-01T10:00:00Z"));
  await note(org, debtor, { refund: "CASH", total: 100, validatedAt: at(3 * DAY) }); // left out -> debt stays 500

  const historicalCreditor = await customer(org, "Crediteur historique");
  await creditSale(org, historicalCreditor, 100, new Date("2026-10-01T10:00:00Z"));
  await note(org, historicalCreditor, { refund: "CASH", total: 150, validatedAt: at(-3 * DAY) }); // deducted: raw -50

  const refundedOnly = await customer(org, "Rembourse seulement");
  await note(org, refundedOnly, { refund: "CASH", total: 70, validatedAt: at(3 * DAY) }); // no sale at all: nothing owed, not a creditor

  const view = await core.loadReceivablesOverview(prisma, org.id, { now: NOW, settings: SETTINGS, cutover: T });
  assert.equal(view.totals.totalOutstanding, 500);
  assert.equal(view.totals.debtorCount, 1);
  assert.equal(view.debtors[0].balance, 500);
  assert.equal(view.debtors[0].cashCreditNotesTotal, 0, "its cash refund is not deducted, so it is not shown as a deducted cash note");
  assert.equal(view.creditors.count, 1, "only the historical one");
  assert.equal(view.creditors.rows[0].creditBalance, 50);
  assert.equal(view.creditors.rows[0].explainedByCashCreditNotes, true);
  assert.deepEqual(view.dataNotes.cashCreditNotes, { count: 1, total: 150 });
  assert.deepEqual(view.dataNotes.cashRefundsNotDeducted, { count: 2, total: 170 }, "100 + 70, including the customer with no sale");
  assert.equal(view.dataNotes.agingMismatchCount, 0);

  const dormant = await core.loadReceivablesOverview(prisma, org.id, { now: NOW, settings: SETTINGS, cutover: null });
  assert.equal(dormant.totals.totalOutstanding, 400, "historical rule: 500 - 100");
  assert.equal(dormant.creditors.count, 2, "the refund-only customer is a creditor of 70 under the historical rule");
});
