import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import Dexie from "dexie";

import { computeDiscountedLineTotals } from "@/lib/pos-discount";

import { closeCounterPosDatabase, getCounterPosDatabase } from "./database";
import { cleanupOnLogout } from "./offline-logout";
import {
  clearOfflineSession,
  closeOfflineSessionDatabase,
  markOfflineDataReady,
  OFFLINE_SESSION_DB_NAME,
  OFFLINE_SESSION_TTL_MS,
  offlineSessionToCurrentUser,
  readOfflineSession,
  saveOfflineSession,
} from "./offline-session";
import { buildOfflineSaleInput, type OfflineCartLine } from "./offline-sale";
import { resolveOfflineStartup } from "./offline-startup";
import { hydrateCounterPosSnapshot, loadCachedCounterPosContext } from "./pos-data-source";
import { syncOfflineCounterSales } from "./sales-sync";
import { countOfflineSalesByStatus, createOfflineSale, listOfflineSales, loadCart, saveCart } from "./sales-store";
import { makeContext, uniqueOrg, unwrap } from "./test-helpers";

const T0 = new Date("2026-09-25T08:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 3_600_000;

type TestUser = { id: string; role: "admin" | "cashier"; organizationId: string; nom: string };

function user(org: string, role: "admin" | "cashier" = "cashier", id = "user-1"): TestUser {
  return { id, role, organizationId: org, nom: role === "admin" ? "Admin Un" : "Caissier Un" };
}

/** Everything a real online session leaves behind: the mirror + the offline session. */
async function onlineLogin(org: string, role: "admin" | "cashier" = "cashier", id = "user-1") {
  const scope = { organizationId: org, userId: id };
  const context = makeContext({ user: { id, name: "Nom" } });
  unwrap(await hydrateCounterPosSnapshot(scope, context, { now: T0 }));
  const saved = await saveOfflineSession(user(org, role, id), { now: T0 });
  assert.equal(saved.ok, true);
  assert.equal(await markOfflineDataReady(scope, { now: T0 }), true);
  return scope;
}

/** "Close the application": every connection is dropped, only disk state remains. */
function closeApp(org: string) {
  closeOfflineSessionDatabase();
  closeCounterPosDatabase(org);
}

function line(productId: string, quantity: number, unitPriceHT = 10, taxRate = 20): OfflineCartLine {
  const t = computeDiscountedLineTotals({ unitPriceHT, taxRate, quantity, discountUnitAmount: 0 });
  return {
    productId, reference: `REF-${productId}`, designation: `Produit ${productId}`, quantity, unitPriceHT,
    tauxTVA: taxRate, discountUnitAmount: 0, discountAmount: t.discountAmount, netHT: t.totalHT,
    tvaAmount: t.taxAmount, totalTTC: t.totalTTC,
  };
}

let saleSeq = 0;

async function sellOffline(scope: { organizationId: string; userId: string }, key: string, productId = "p1", quantity = 2) {
  const built = buildOfflineSaleInput({
    depotId: "depot-1", stockLocationId: "loc-1", bankAccounts: [], lines: [line(productId, quantity)],
    customer: { id: "cust-1", code: "34211", name: "Client Un" }, paymentMethod: "CASH", chequeNumber: "", banque: "",
    bankAccountId: "", mixedAmounts: { cash: 0, cheque: 0 }, idempotencyKey: key, reservation: null,
  });
  assert.ok(built.ok);
  if (!built.ok) throw new Error("unreachable");
  return unwrap(await createOfflineSale(scope, built.input, { now: at(2 * HOUR + ++saleSeq * 1000) })).sale; // strictly increasing: a deterministic queue order
}

/** POST /api/sales/sync stand-in: idempotent on the key, like Sale.idempotencyKey. */
function fakeServer() {
  const sales = new Map<string, string>();
  const requests: Array<{ idempotencyKey: string; organizationId: string; userId: string }> = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ idempotencyKey: body.idempotencyKey, organizationId: body.organizationId, userId: body.userId });
    const known = sales.has(body.idempotencyKey);
    if (!known) sales.set(body.idempotencyKey, `srv-${sales.size + 1}`);
    return new Response(
      JSON.stringify({
        success: true, result: known ? "ALREADY_SYNCED" : "CREATED", localId: body.localId,
        serverSaleId: sales.get(body.idempotencyKey), officialDisplayNumber: `${sales.size}/2026`,
        serverTotalTTC: body.totals.totalTTC, totalMismatch: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { sales, requests, fetchFn };
}

const noLock = async <T>(_name: string, fn: () => Promise<T>) => fn();

async function rawWriteSession(row: Record<string, unknown>) {
  closeOfflineSessionDatabase();
  const raw = new Dexie(OFFLINE_SESSION_DB_NAME);
  raw.version(1).stores({ identity: "key" });
  await raw.table("identity").put({ key: "current", ...row });
  raw.close();
}

// ---------------------------------------------------------------------------

test("1. online login initialises the offline session, with no secret in it", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org);
  const read = await readOfflineSession({ now: at(HOUR) });
  assert.equal(read.status, "VALID");
  if (read.status !== "VALID") return;
  assert.deepEqual(Object.keys(read.session).sort(), ["dataReadyAt", "expiresAt", "issuedAt", "name", "organizationId", "role", "userId"]);
  assert.equal(read.session.organizationId, org);
  assert.equal(read.session.dataReadyAt, T0.toISOString());
  assert.equal(new Date(read.session.expiresAt).getTime() - new Date(read.session.issuedAt).getTime(), OFFLINE_SESSION_TTL_MS);
  const json = JSON.stringify(read.session).toLowerCase();
  for (const forbidden of ["password", "token", "email", "secret"]) assert.equal(json.includes(forbidden), false);
});

test("2-4. close the app, start without Internet: a valid session opens the POS on the local data", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org);
  closeApp(org);

  const startup = await resolveOfflineStartup({ now: at(3 * HOUR) });
  assert.equal(startup.state, "READY");
  if (startup.state !== "READY") return;
  assert.deepEqual(startup.scope, { organizationId: org, userId: "user-1" });
  assert.equal(startup.syncedAt, T0.toISOString());
  assert.equal(startup.context.canSell, true);
});

test("10-11. the catalogue and the customers are available offline", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org);
  closeApp(org);
  const startup = await resolveOfflineStartup({ now: at(HOUR) });
  assert.equal(startup.state, "READY");
  if (startup.state !== "READY") return;
  assert.deepEqual(startup.context.products.map((p) => p.id).sort(), ["p1", "p2", "p3"]);
  assert.equal(startup.context.products.find((p) => p.id === "p1")?.barcode, "611000000001");
  assert.deepEqual(startup.context.customers.map((c) => c.id).sort(), ["cust-1", "cust-2"]);
  assert.equal(startup.context.defaultCustomerId, "cust-1");
});

test("5. no offline session: access refused, first login needs Internet", async () => {
  await clearOfflineSession();
  closeOfflineSessionDatabase();
  const startup = await resolveOfflineStartup({ now: at(HOUR) });
  assert.deepEqual(startup, { state: "LOGIN_REQUIRED", reason: "MISSING" });
});

test("6. expired offline session: access refused", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org);
  closeApp(org);
  const justBefore = await resolveOfflineStartup({ now: at(OFFLINE_SESSION_TTL_MS - 1000) });
  assert.equal(justBefore.state, "READY");
  const expired = await resolveOfflineStartup({ now: at(OFFLINE_SESSION_TTL_MS + 1000) });
  assert.deepEqual(expired, { state: "LOGIN_REQUIRED", reason: "EXPIRED" });
});

test("a new online confirmation renews the session (sliding window)", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org);
  await saveOfflineSession(user(org), { now: at(15 * HOUR) });
  const later = await resolveOfflineStartup({ now: at(30 * HOUR) });
  assert.equal(later.state, "READY"); // 30 h after login, 15 h after the renewal
});

test("7-8. ADMIN stays ADMIN and CAISSIER stays CAISSIER offline; no other role may start offline", async () => {
  for (const role of ["admin", "cashier"] as const) {
    await clearOfflineSession();
    const org = uniqueOrg();
    await onlineLogin(org, role);
    closeApp(org);
    const startup = await resolveOfflineStartup({ now: at(HOUR) });
    assert.equal(startup.state, "READY");
    if (startup.state !== "READY") return;
    assert.equal(startup.session.role, role);
    assert.equal(offlineSessionToCurrentUser(startup.session).role, role);
    assert.equal(offlineSessionToCurrentUser(startup.session).organizationId, org);
  }
  await clearOfflineSession();
  const org = uniqueOrg();
  for (const role of ["driver", "depot_manager", "super_admin", "root"]) {
    const saved = await saveOfflineSession({ ...user(org), role: role as never }, { now: T0 });
    assert.deepEqual(saved, { ok: false, reason: "ROLE_NOT_ALLOWED" });
  }
  assert.deepEqual(await saveOfflineSession({ ...user(org), organizationId: null } as never, { now: T0 }), { ok: false, reason: "NO_ORGANIZATION" });
  assert.equal((await readOfflineSession({ now: T0 })).status, "MISSING");
});

test("9. the organization cannot be changed offline: only the stored session names it, and a tampered record is refused", async () => {
  await clearOfflineSession();
  const orgA = uniqueOrg("orgA");
  const orgB = uniqueOrg("orgB");
  const scopeB = await onlineLogin(orgB, "admin", "user-b"); // another organization's data on the same PC
  await clearOfflineSession();
  await onlineLogin(orgA);
  closeApp(orgA);
  closeCounterPosDatabase(orgB);

  const startup = await resolveOfflineStartup({ now: at(HOUR) });
  assert.equal(startup.state, "READY");
  if (startup.state !== "READY") return;
  assert.equal(startup.scope.organizationId, orgA); // never orgB's mirror
  assert.equal(startup.session.role, "cashier");
  // the other organization's mirror is not reachable through this scope
  const foreign = await loadCachedCounterPosContext({ organizationId: orgA, userId: "user-b" });
  assert.equal(foreign.ok, false);
  assert.ok(scopeB);

  // Tampered records are refused, not trusted.
  const base = { userId: "user-1", organizationId: orgA, role: "cashier", name: "X", issuedAt: T0.toISOString(), dataReadyAt: T0.toISOString() };
  await rawWriteSession({ ...base, expiresAt: at(OFFLINE_SESSION_TTL_MS).toISOString(), role: "super_admin" });
  assert.equal((await readOfflineSession({ now: at(HOUR) })).status, "INVALID");
  await rawWriteSession({ ...base, expiresAt: at(OFFLINE_SESSION_TTL_MS * 10).toISOString() }); // expiry pushed far out
  assert.equal((await readOfflineSession({ now: at(HOUR) })).status, "INVALID");
  await rawWriteSession({ ...base, issuedAt: at(50 * HOUR).toISOString(), expiresAt: at(60 * HOUR).toISOString() }); // issued in the future
  assert.equal((await readOfflineSession({ now: at(HOUR) })).status, "INVALID");
  await rawWriteSession({ ...base, organizationId: "", expiresAt: at(OFFLINE_SESSION_TTL_MS).toISOString() });
  assert.equal((await resolveOfflineStartup({ now: at(HOUR) })).state, "LOGIN_REQUIRED");
});

test("a different user signing in online replaces the identity and never inherits the previous user's readiness", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org, "cashier", "user-1");
  // user-2 logs in online but never opened the POS (no mirror for them yet)
  assert.equal((await saveOfflineSession(user(org, "admin", "user-2"), { now: T0 })).ok, true);
  closeApp(org);
  const startup = await resolveOfflineStartup({ now: at(HOUR) });
  assert.equal(startup.state, "DATA_MISSING");
  if (startup.state === "DATA_MISSING") {
    assert.equal(startup.session.userId, "user-2");
    assert.equal(startup.session.dataReadyAt, "");
  }
});

test("12-14. offline sales are kept in the local queue, across a restart, several of them", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org);
  closeApp(org);

  const startup = await resolveOfflineStartup({ now: at(HOUR) });
  assert.equal(startup.state, "READY");
  if (startup.state !== "READY") return;
  const first = await sellOffline(startup.scope, "off-1");
  assert.equal(first.status, "PENDING");
  assert.equal(first.organizationId, org);
  assert.equal(first.userId, "user-1");
  await sellOffline(startup.scope, "off-2", "p3", 1);
  await sellOffline(startup.scope, "off-3", "p1", 4);

  // The cart in progress survives too.
  unwrap(await saveCart(startup.scope, { lines: [{ productId: "p2", quantity: 1, discountUnitAmount: 0 }], customerId: "cust-2", paymentMethod: "CASH", chequeNumber: "", banque: "", bankAccountId: "", mixedCash: 0, mixedCheque: 0, idempotencyKey: "cart-key", reservedSaleNumber: null, reservedSaleYear: null }));

  closeApp(org);
  const reopened = await resolveOfflineStartup({ now: at(3 * HOUR) });
  assert.equal(reopened.state, "READY");
  if (reopened.state !== "READY") return;
  const pending = unwrap(await listOfflineSales(reopened.scope, { statuses: ["PENDING"] }));
  assert.equal(pending.length, 3);
  assert.deepEqual(pending.map((sale) => sale.idempotencyKey).sort(), ["off-1", "off-2", "off-3"]);
  assert.equal(unwrap(await loadCart(reopened.scope))?.idempotencyKey, "cart-key");
  // stock shown offline is net of those sales: p1 20 - 2 - 4
  assert.equal(reopened.context.products.find((p) => p.id === "p1")?.availableQuantity, 14);
});

test("15-16. Internet is back: the queue synchronises, and a second pass creates no duplicate", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org);
  const startup = await resolveOfflineStartup({ now: at(HOUR) });
  assert.equal(startup.state, "READY");
  if (startup.state !== "READY") return;
  await sellOffline(startup.scope, "off-1");
  await sellOffline(startup.scope, "off-2", "p3", 1);
  closeApp(org);

  const server = fakeServer();
  const deps = { fetchFn: server.fetchFn, now: () => at(5 * HOUR), withLock: noLock };
  const first = await syncOfflineCounterSales(startup.scope, deps);
  assert.equal(first.synced, 2);
  const again = await syncOfflineCounterSales(startup.scope, deps);
  assert.equal(again.status, "NOTHING_TO_SYNC");
  assert.equal(server.sales.size, 2);
  assert.equal(server.requests.length, 2);
  assert.ok(server.requests.every((r) => r.organizationId === org && r.userId === "user-1"));
  assert.deepEqual(unwrap(await countOfflineSalesByStatus(startup.scope)), { PENDING: 0, SYNCING: 0, SYNCED: 2, FAILED: 0 });
});

test("17. after logout no offline session can be started, even offline", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  await onlineLogin(org);
  closeApp(org);
  assert.equal((await resolveOfflineStartup({ now: at(HOUR) })).state, "READY");

  const cleanup = await cleanupOnLogout();
  assert.equal(cleanup.identityCleared, true);
  assert.equal(cleanup.organizationId, org);
  closeApp(org);
  assert.deepEqual(await resolveOfflineStartup({ now: at(HOUR) }), { state: "LOGIN_REQUIRED", reason: "MISSING" });
});

test("18. unsynchronised sales survive logout (catalogue and identity do not) and go out after the next login", async () => {
  await clearOfflineSession();
  const org = uniqueOrg();
  const scope = await onlineLogin(org);
  const failedSale = await sellOffline(scope, "off-fail", "p3", 1); // oldest: rejected first
  const pendingSale = await sellOffline(scope, "off-keep"); // then the server goes down
  // one of them fails permanently before the logout
  const rejecting: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.idempotencyKey !== "off-fail") return new Response("{}", { status: 503, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ success: false, code: "CUSTOMER_INACTIVE", message: "Client inactif ou bloque.", retryable: false }), { status: 409, headers: { "content-type": "application/json" } });
  };
  await syncOfflineCounterSales(scope, { fetchFn: rejecting, now: () => at(3 * HOUR), withLock: noLock, ignoreBackoff: true });
  unwrap(await saveCart(scope, { lines: [{ productId: "p1", quantity: 1, discountUnitAmount: 0 }], customerId: null, paymentMethod: "CASH", chequeNumber: "", banque: "", bankAccountId: "", mixedCash: 0, mixedCheque: 0, idempotencyKey: "kept-cart", reservedSaleNumber: null, reservedSaleYear: null }));

  const cleanup = await cleanupOnLogout();
  assert.equal(cleanup.referenceDataPurged, true);
  closeApp(org);

  // Identity and mirrored reference data are gone...
  assert.equal((await readOfflineSession({ now: at(4 * HOUR) })).status, "MISSING");
  const mirror = await loadCachedCounterPosContext(scope);
  assert.equal(mirror.ok, false);
  const db = getCounterPosDatabase(org);
  assert.ok(db);
  assert.deepEqual(
    [await db.products.count(), await db.customers.count(), await db.stockLevels.count(), await db.posContexts.count(), await db.syncStates.count()],
    [0, 0, 0, 0, 0],
  );
  // ...but every unsynchronised sale (and the unsent cart) is still there, untouched.
  const kept = unwrap(await listOfflineSales(scope));
  assert.deepEqual(kept.map((s) => [s.idempotencyKey, s.status]).sort(), [["off-fail", "FAILED"], ["off-keep", "PENDING"]]);
  assert.equal(kept.find((s) => s.idempotencyKey === "off-fail")?.lastError?.message, "Client inactif ou bloque.");
  assert.equal(kept.find((s) => s.idempotencyKey === "off-keep")?.localId, pendingSale.localId);
  assert.ok(failedSale.localId);
  assert.equal(unwrap(await loadCart(scope))?.idempotencyKey, "kept-cart");

  // Next online login: identity back, the queue synchronises.
  await saveOfflineSession(user(org), { now: at(6 * HOUR) });
  const server = fakeServer();
  const result = await syncOfflineCounterSales(scope, { fetchFn: server.fetchFn, now: () => at(6 * HOUR), withLock: noLock });
  assert.equal(result.synced, 1);
  assert.equal(server.sales.size, 1);
  assert.equal(unwrap(await listOfflineSales(scope, { statuses: ["SYNCED"] })).length, 1);
});

test("logout purges only its own organization's mirror", async () => {
  await clearOfflineSession();
  const orgA = uniqueOrg("A");
  const orgB = uniqueOrg("B");
  const scopeB = await onlineLogin(orgB, "admin", "user-b");
  await clearOfflineSession();
  await onlineLogin(orgA);
  await cleanupOnLogout();
  assert.equal((await loadCachedCounterPosContext(scopeB)).ok, true);
});
