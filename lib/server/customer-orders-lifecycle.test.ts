import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLIENT_LOGIN_MAX_FAILURES_PER_IP,
  CLIENT_LOGIN_MAX_FAILURES_PER_ORG,
  CLIENT_LOGIN_WINDOW_MS,
} from "@/lib/client-portal-rules";

import { authenticateClient } from "./client-portal-core";
import {
  linkCustomerOrderToSale,
  listCustomerOrdersCore,
  releaseCustomerOrderForCancelledSale,
} from "./customer-orders-core";

/**
 * Online-order lifecycle on IN-MEMORY fake handles: no database, no network
 * (these run, and mean something, when the database is unreachable). The fake
 * applies the same `where` guards the real queries carry, so a guard that is
 * removed from the code makes these tests fail. Real-PostgreSQL concurrency
 * is covered by the guarded updateMany + Serializable transaction themselves
 * (client-portal-core.test.ts runs against a real database when one exists).
 */

type FakeOrder = {
  id: string;
  organizationId: string;
  orderNumber: string;
  status: "SUBMITTED" | "ACCEPTED" | "REJECTED" | "CONVERTED" | "CANCELLED";
  customerId: string;
  convertedSaleId: string | null;
  convertedAt: Date | null;
  linkedSaleStatus?: string | null;
};
type Where = Record<string, unknown>;

function makeFake(orders: FakeOrder[], options: { staleReads?: boolean } = {}) {
  const snapshot = orders.map((order) => ({ ...order }));
  const audit: Array<Record<string, unknown>> = [];
  const matches = (order: FakeOrder, where: Where) =>
    Object.entries(where).every(([key, value]) => (order as unknown as Record<string, unknown>)[key] === value);
  const db = {
    customerOrder: {
      findFirst: async ({ where }: { where: Where }) => {
        const source = options.staleReads ? snapshot : orders;
        const found = source.find((order) => matches(order, where));
        return found ? { ...found } : null;
      },
      updateMany: async ({ where, data }: { where: Where; data: Partial<FakeOrder> }) => {
        const targets = orders.filter((order) => matches(order, where));
        for (const order of targets) Object.assign(order, data);
        return { count: targets.length };
      },
      findMany: async ({ where }: { where: Where }) =>
        orders
          .filter((order) => matches(order, where))
          .map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            contactPhone: null,
            totalTTC: 30,
            createdAt: new Date("2026-10-09T10:00:00Z"),
            processedAt: null,
            convertedSaleId: order.convertedSaleId,
            convertedSale: order.linkedSaleStatus ? { status: order.linkedSaleStatus } : null,
            customer: { id: order.customerId, name: "Karim", code: "342115" },
            processedBy: null,
            lines: [{ quantity: 2 }],
          })),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => void audit.push(data),
    },
  };
  return { db: db as never, orders, audit };
}

const order = (over: Partial<FakeOrder> = {}): FakeOrder => ({
  id: "ord1",
  organizationId: "orgA",
  orderNumber: "CMD-000001",
  status: "CONVERTED",
  customerId: "cust1",
  convertedSaleId: "sale1",
  convertedAt: new Date("2026-10-09T10:05:00Z"),
  ...over,
});

// ---------------------------------------------------------------------------
// 1. Cancelling the sale re-opens ITS order (and only that one)
// ---------------------------------------------------------------------------

test("cancelling the linked sale puts the order back to ACCEPTED, clears the link and writes an audit row", async () => {
  const { db, orders, audit } = makeFake([order()]);
  const result = await releaseCustomerOrderForCancelledSale(db, {
    organizationId: "orgA",
    saleId: "sale1",
    userId: "admin1",
    saleInvoiceNumber: "VC-1",
  });
  assert.deepEqual(result, { released: true, orderId: "ord1" });
  assert.equal(orders[0].status, "ACCEPTED");
  assert.equal(orders[0].convertedSaleId, null);
  assert.equal(orders[0].convertedAt, null);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "CUSTOMER_ORDER_REOPENED");
  assert.equal(audit[0].entityId, "ord1");
  assert.equal(audit[0].userId, "admin1");
  assert.deepEqual(audit[0].oldValue, { status: "CONVERTED", convertedSaleId: "sale1" });
  assert.deepEqual(audit[0].newValue, { status: "ACCEPTED", reason: "SALE_CANCELLED", orderNumber: "CMD-000001", saleInvoiceNumber: "VC-1" });
});

test("an order is never re-opened by the cancellation of a sale it is NOT linked to", async () => {
  const { db, orders, audit } = makeFake([order({ convertedSaleId: "sale-other" })]);
  const result = await releaseCustomerOrderForCancelledSale(db, { organizationId: "orgA", saleId: "sale1", userId: "admin1" });
  assert.deepEqual(result, { released: false });
  assert.equal(orders[0].status, "CONVERTED");
  assert.equal(orders[0].convertedSaleId, "sale-other");
  assert.equal(audit.length, 0);
});

test("other organisations and orders in another state are untouched; a second release is a no-op", async () => {
  for (const other of [order({ organizationId: "orgB" }), order({ status: "ACCEPTED", convertedSaleId: null }), order({ status: "REJECTED", convertedSaleId: null })]) {
    const { db, orders, audit } = makeFake([other]);
    const result = await releaseCustomerOrderForCancelledSale(db, { organizationId: "orgA", saleId: "sale1", userId: "admin1" });
    assert.equal(result.released, false);
    assert.equal(orders[0].status, other.status);
    assert.equal(audit.length, 0);
  }
  const { db, audit } = makeFake([order()]);
  assert.equal((await releaseCustomerOrderForCancelledSale(db, { organizationId: "orgA", saleId: "sale1", userId: "a" })).released, true);
  assert.equal((await releaseCustomerOrderForCancelledSale(db, { organizationId: "orgA", saleId: "sale1", userId: "a" })).released, false);
  assert.equal(audit.length, 1, "one audit row, not two");
});

test("a lost race on release (state changed between read and write) releases nothing and logs nothing", async () => {
  const { db, orders, audit } = makeFake([order()], { staleReads: true });
  // someone re-links the order to another sale after our read
  orders[0].convertedSaleId = "sale-new";
  const result = await releaseCustomerOrderForCancelledSale(db, { organizationId: "orgA", saleId: "sale1", userId: "a" });
  assert.deepEqual(result, { released: false });
  assert.equal(orders[0].convertedSaleId, "sale-new");
  assert.equal(audit.length, 0);
});

test("the cancellation runs inside cancelSale's own transaction, after the sale update and before its audit row", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./sale-admin.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const body = source.slice(source.indexOf("export async function cancelSale("), source.indexOf("export async function reviseSale("));
  const statusAt = body.indexOf('data: { status: "CANCELLED" }');
  const releaseAt = body.indexOf("await releaseCustomerOrderForCancelledSale(tx, {");
  const auditAt = body.indexOf('action: "SALE_CANCELLED"');
  assert.ok(statusAt > 0 && releaseAt > statusAt && auditAt > releaseAt);
  assert.match(body, /releaseCustomerOrderForCancelledSale\(tx, \{\s+organizationId: sessionUser\.organizationId,\s+saleId: sale\.id,/);
  // the sale row itself is only ever updated with the status (history preserved)
  assert.equal((body.match(/tx\.sale\.update\(/g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// 2. "Facture en attente" is derived, never stored
// ---------------------------------------------------------------------------

test("CONVERTED + linked sale still DRAFT = invoice pending; collected sale = invoiced; other statuses never pending", async () => {
  const { db } = makeFake([
    order({ id: "p", linkedSaleStatus: "DRAFT" }),
    order({ id: "i", linkedSaleStatus: "PAID", convertedSaleId: "s2" }),
    order({ id: "c", linkedSaleStatus: "CREDIT", convertedSaleId: "s3" }),
    order({ id: "a", status: "ACCEPTED", convertedSaleId: null, linkedSaleStatus: null }),
  ]);
  const { items } = await listCustomerOrdersCore(db, "orgA");
  const byId = Object.fromEntries(items.map((item) => [item.id, item.invoicePending]));
  assert.deepEqual(byId, { p: true, i: false, c: false, a: false });
});

test("a pending invoice keeps the order from being opened/converted a second time (link is still taken)", async () => {
  const { db, audit } = makeFake([order({ linkedSaleStatus: "DRAFT" })]);
  assert.deepEqual(
    await linkCustomerOrderToSale(db, { organizationId: "orgA", customerOrderId: "ord1", saleId: "sale2", saleCustomerId: "cust1", userId: "u1" }),
    { ok: false, reason: "ALREADY_CONVERTED" },
  );
  assert.equal(audit.length, 0, "a refused link writes no audit row");
});

test("converting an ACCEPTED order writes one CUSTOMER_ORDER_CONVERTED audit row (previous status, new status, sale id, user)", async () => {
  const { db, orders, audit } = makeFake([order({ status: "ACCEPTED", convertedSaleId: null, convertedAt: null })]);
  const result = await linkCustomerOrderToSale(db, {
    organizationId: "orgA",
    customerOrderId: "ord1",
    saleId: "sale9",
    saleCustomerId: "cust1",
    userId: "cashier1",
    saleInvoiceNumber: "VC-9",
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(orders[0].status, "CONVERTED");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "CUSTOMER_ORDER_CONVERTED");
  assert.equal(audit[0].entityType, "CustomerOrder");
  assert.equal(audit[0].entityId, "ord1");
  assert.equal(audit[0].organizationId, "orgA");
  assert.equal(audit[0].userId, "cashier1");
  assert.deepEqual(audit[0].oldValue, { status: "ACCEPTED" });
  assert.deepEqual(audit[0].newValue, { status: "CONVERTED", saleId: "sale9", orderNumber: "CMD-000001", saleInvoiceNumber: "VC-9" });
});

test("no audit row for a link refused because the order is not ACCEPTED, is of another customer, or unknown", async () => {
  for (const [over, customer] of [
    [{ status: "REJECTED" as const, convertedSaleId: null, convertedAt: null }, "cust1"],
    [{ status: "ACCEPTED" as const, convertedSaleId: null, convertedAt: null }, "other-cust"],
  ] as const) {
    const { db, audit } = makeFake([order(over)]);
    const result = await linkCustomerOrderToSale(db, { organizationId: "orgA", customerOrderId: "ord1", saleId: "s", saleCustomerId: customer, userId: "u1" });
    assert.equal(result.ok, false);
    assert.equal(audit.length, 0);
  }
  const { db, audit } = makeFake([]);
  assert.deepEqual(
    await linkCustomerOrderToSale(db, { organizationId: "orgA", customerOrderId: "nope", saleId: "s", saleCustomerId: "cust1", userId: "u1" }),
    { ok: false, reason: "NOT_FOUND" },
  );
  assert.equal(audit.length, 0);
});

// ---------------------------------------------------------------------------
// 3. No double invoicing
// ---------------------------------------------------------------------------

test("two simultaneous sales for the same ACCEPTED order: exactly one links, the other is refused", async () => {
  // both tills read the order as ACCEPTED (stale reads) - only the guarded update decides
  const { db, orders, audit } = makeFake([order({ status: "ACCEPTED", convertedSaleId: null, convertedAt: null })], { staleReads: true });
  const params = { organizationId: "orgA", customerOrderId: "ord1", saleCustomerId: "cust1", userId: "u1" };
  const [first, second] = await Promise.all([
    linkCustomerOrderToSale(db, { ...params, saleId: "saleA" }),
    linkCustomerOrderToSale(db, { ...params, saleId: "saleB" }),
  ]);
  assert.deepEqual([first.ok, second.ok].sort(), [false, true]);
  const loser = first.ok ? second : first;
  assert.deepEqual(loser, { ok: false, reason: "ALREADY_CONVERTED" });
  assert.equal(orders[0].status, "CONVERTED");
  assert.equal(orders[0].convertedSaleId, first.ok ? "saleA" : "saleB");
  assert.equal(audit.filter((row) => row.action === "CUSTOMER_ORDER_CONVERTED").length, 1, "only the winner is audited");
});

test("the sale's own transaction rolls back when the link fails (no invoice without its order link)", async () => {
  const { readFileSync } = await import("node:fs");
  const sales = readFileSync(new URL("./counter-sales.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(sales, /if \(!link\.ok\) \{\s+throw new OperationsServiceError\(LINK_CUSTOMER_ORDER_MESSAGES\[link\.reason\], 409\);/);
  assert.ok(sales.indexOf("const link = await linkCustomerOrderToSale(tx, {") > sales.indexOf("const sale = await tx.sale.create("));
  // a retry of the same attempt (double click) carries the same idempotency key and is answered before any link logic
  assert.ok(sales.indexOf("parsed.data.idempotencyKey") < sales.indexOf("linkCustomerOrderToSale(tx"));
  // the audit row needs the acting user and the invoice number, both passed by the caller inside the same transaction
  const callAt = sales.indexOf("const link = await linkCustomerOrderToSale(tx, {");
  const call = sales.slice(callAt, sales.indexOf("if (!link.ok)", callAt));
  assert.ok(call.includes("userId: sessionUser.id,") && call.includes("saleInvoiceNumber: sale.invoiceNumber,"));
  const pos = readFileSync(new URL("../../components/pos/pos-layout.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(pos, /idempotencyKey: idempotencyKeyRef\.current,\n\s+\/\/ The online order this cart came from/);
});

// ---------------------------------------------------------------------------
// 5. Same orders, same buttons for every staff member
// ---------------------------------------------------------------------------

test("admin and cashier see exactly the same orders: the list is scoped by organisation only, never by user or role", async () => {
  const { db } = makeFake([order({ id: "x", status: "SUBMITTED", convertedSaleId: null }), order({ id: "y", status: "ACCEPTED", convertedSaleId: null })]);
  const asAdmin = await listCustomerOrdersCore(db, "orgA");
  const asCashier = await listCustomerOrdersCore(db, "orgA");
  assert.deepEqual(asAdmin, asCashier);
  assert.equal(listCustomerOrdersCore.length <= 3, true);
  const { readFileSync } = await import("node:fs");
  const core = readFileSync(new URL("./customer-orders-core.ts", import.meta.url), "utf8");
  const listBody = core.slice(core.indexOf("export async function listCustomerOrdersCore("), core.indexOf("export async function getCustomerOrderDetailCore("));
  assert.equal(/userId|role/.test(listBody), false);
  // the UI decides buttons from the order's status only (canStaffTransition / canOpenInPos), not from the role
  for (const file of ["../../components/customer-orders/customer-orders-view.tsx", "../../components/customer-orders/customer-order-detail-dialog.tsx"]) {
    assert.equal(/useAuth|currentUser|role/.test(readFileSync(new URL(file, import.meta.url), "utf8")), false, file);
  }
});

// ---------------------------------------------------------------------------
// 4. Throttle: caps unchanged, blocks audited once, nothing sensitive logged
// ---------------------------------------------------------------------------

function makeLoginFake(counts: { ip: number; org: number }) {
  const audit: Array<Record<string, unknown>> = [];
  const attempts: string[] = [];
  const db = {
    clientLoginAttempt: {
      deleteMany: async () => ({ count: 0 }),
      count: async ({ where }: { where: { key: string } }) => (where.key.startsWith("ip:") ? counts.ip : counts.org),
      createMany: async ({ data }: { data: Array<{ key: string }> }) => void attempts.push(...data.map((row) => row.key)),
    },
    organization: { findFirst: async () => ({ id: "orgA", code: "COMDIS-PRINCIPAL" }) },
    customer: { findFirst: async () => ({ id: "cust1", name: "Karim", code: "342115" }) },
    auditLog: {
      findFirst: async ({ where }: { where: { entityId: string } }) => (audit.some((row) => row.entityId === where.entityId) ? { id: "x" } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => void audit.push(data),
    },
  };
  return { db: db as never, audit, attempts };
}

test("the caps are exactly 10 per IP, 30 per organisation, over 15 minutes (unchanged)", () => {
  assert.equal(CLIENT_LOGIN_MAX_FAILURES_PER_IP, 10);
  assert.equal(CLIENT_LOGIN_MAX_FAILURES_PER_ORG, 30);
  assert.equal(CLIENT_LOGIN_WINDOW_MS, 15 * 60 * 1000);
});

test("below the caps nothing is blocked nor audited; at a cap the login is refused with a throttle audit row", async () => {
  const below = makeLoginFake({ ip: 9, org: 29 });
  const ok = await authenticateClient(below.db, { organizationCode: "comdis-principal", customerCode: "15" }, { ip: "1.2.3.4" });
  assert.equal(ok.ok, true);
  assert.equal(below.audit.length, 0);

  const ipCap = makeLoginFake({ ip: 10, org: 0 });
  assert.deepEqual(await authenticateClient(ipCap.db, { organizationCode: "COMDIS-PRINCIPAL", customerCode: "15" }, { ip: "1.2.3.4" }), { ok: false, reason: "THROTTLED" });
  assert.equal(ipCap.audit.length, 1);
  assert.equal(ipCap.audit[0].action, "CLIENT_LOGIN_THROTTLED");
  assert.equal(ipCap.audit[0].entityId, "ip:1.2.3.4");

  const orgCap = makeLoginFake({ ip: 0, org: 30 });
  assert.equal((await authenticateClient(orgCap.db, { organizationCode: "COMDIS-PRINCIPAL", customerCode: "15" }, { ip: "1.2.3.4" })).ok, false);
  assert.equal(orgCap.audit[0].entityId, "org:COMDIS-PRINCIPAL");
  assert.equal(orgCap.audit[0].organizationId, "orgA");
  assert.equal(orgCap.attempts.length, 0, "a blocked attempt is not counted again");
});

test("the throttle is audited ONCE per key per window (a flood of blocked attempts cannot flood the log)", async () => {
  const both = makeLoginFake({ ip: 10, org: 30 });
  for (let i = 0; i < 5; i += 1) {
    await authenticateClient(both.db, { organizationCode: "COMDIS-PRINCIPAL", customerCode: "15" }, { ip: "1.2.3.4" });
  }
  assert.equal(both.audit.length, 2, "one row for the IP key, one for the organisation key");
  assert.deepEqual(both.audit.map((row) => (row.newValue as { scope: string }).scope).sort(), ["IP", "ORGANIZATION"]);
});

test("the throttle audit row holds no customer code, phone, password or token", async () => {
  const { db, audit } = makeLoginFake({ ip: 10, org: 30 });
  await authenticateClient(db, { organizationCode: "COMDIS-PRINCIPAL", customerCode: "SECRET-CUSTOMER-CODE-342115" }, { ip: "1.2.3.4" });
  const dump = JSON.stringify(audit);
  assert.equal(dump.includes("SECRET-CUSTOMER-CODE"), false);
  assert.equal(/password|phone|token|cookie/i.test(dump), false);
  assert.deepEqual(Object.keys(audit[0].newValue as object).sort(), ["failuresInWindow", "organizationCode", "scope", "windowMinutes"]);
  assert.equal(audit[0].ipAddress, "1.2.3.4");
});

test("an audit failure never changes the answer of the login", async () => {
  const { db } = makeLoginFake({ ip: 10, org: 0 });
  (db as unknown as { auditLog: { create: () => Promise<never> } }).auditLog.create = async () => {
    throw new Error("audit table down");
  };
  assert.deepEqual(await authenticateClient(db, { organizationCode: "X", customerCode: "1" }, { ip: "9.9.9.9" }), { ok: false, reason: "THROTTLED" });
});
