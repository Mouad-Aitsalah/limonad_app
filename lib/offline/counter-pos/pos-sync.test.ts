import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import { getCounterPosDatabase } from "./database";
import { FakeServer, makeCustomer, makeProduct, seededServer } from "./fake-server";
import { getOrganizationInfo } from "./profile-store";
import { loadCachedCounterPosContext } from "./pos-data-source";
import { createOfflineSale } from "./sales-store";
import type { CounterPosScope, SyncStateRecord } from "./schema";
import {
  CATALOGUE_PAGE_SIZE,
  isPosSyncRunning,
  startPosDataAutoSync,
  syncPosData,
  type PosAutoSyncOptions,
  type SyncPosDataDeps,
  type SyncPosDataResult,
} from "./pos-sync";
import { effectiveSyncStatus, getPosSyncState, markPosSyncStarted } from "./sync-state-store";
import { makeLine, makeSaleInput, uniqueOrg, unwrap } from "./test-helpers";

const T0 = 1_790_000_000_000; // a fixed instant, so timestamps are deterministic

function clock(start = T0) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

function scopeOf(server: FakeServer): CounterPosScope {
  return { organizationId: server.organizationId, userId: server.userId };
}

function run(server: FakeServer, extra: SyncPosDataDeps = {}, scope = scopeOf(server)) {
  return syncPosData(scope, { fetchFn: server.fetch, getNetworkState: async () => "ONLINE", ...extra });
}

function ok(result: SyncPosDataResult) {
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.message}`);
  return result as Extract<SyncPosDataResult, { ok: true }>;
}

function failed(result: SyncPosDataResult) {
  assert.equal(result.ok, false, "expected the sync to fail");
  return result as Extract<SyncPosDataResult, { ok: false }>;
}

async function cached(scope: CounterPosScope) {
  const result = await loadCachedCounterPosContext(scope, { applyPendingSales: false });
  assert.equal(result.ok, true);
  return (result as Extract<typeof result, { ok: true }>).context;
}

async function state(scope: CounterPosScope): Promise<SyncStateRecord> {
  return unwrap(await getPosSyncState(scope));
}

// ---------------------------------------------------------------------------
// initial download
// ---------------------------------------------------------------------------

test("initial download: products, stock, active customers, bank accounts, organization", async () => {
  const server = seededServer(uniqueOrg(), { products: 3, customers: 3 });
  server.customers[2].status = "INACTIVE"; // c3 must not be cached
  server.identity = { name: "Ma Societe", tradeName: "MS", logoUrl: "https://cdn.test/logo.png" };
  const c = clock();

  const result = ok(await run(server, { now: c.now }));

  assert.equal(result.syncedAt, new Date(T0).toISOString());
  assert.equal(result.catalogueComplete, true);
  assert.equal(result.customersComplete, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.summary.products, { total: 3, added: 3, updated: 0, removed: 0 });
  assert.deepEqual(result.summary.customers, { total: 2, added: 2, updated: 0, removed: 0 });
  assert.equal(result.summary.stockLevels, 3);
  assert.equal(result.summary.catalogueSource, "context");

  const scope = scopeOf(server);
  const context = await cached(scope);
  assert.deepEqual(context.products.map((p) => [p.id, p.salePriceHT, p.salePriceTTC, p.taxRate, p.availableQuantity]), [
    ["p1", 10, 12, 20, 10],
    ["p2", 10, 12, 20, 20],
    ["p3", 10, 12, 20, 30],
  ]);
  assert.equal(context.products[0].barcode, "611000000001");
  assert.equal(context.products[0].reference, "REF-1");
  assert.deepEqual(context.customers.map((cu) => cu.id), ["c1", "c2"]);
  assert.equal(context.customers[0].creditLimit, 1000);
  assert.equal(context.customers[0].creditLimitEnabled, true);
  assert.equal(context.customers[0].status, "ACTIVE");
  assert.equal(context.defaultCustomerId, "c1");
  assert.deepEqual(context.bankAccounts, server.bankAccounts);
  assert.equal(context.stockLocation.id, "loc-1");
  assert.equal(context.depot.name, "Depot 1");

  const info = unwrap(await getOrganizationInfo(scope.organizationId));
  assert.deepEqual([info?.name, info?.tradeName, info?.logoUrl], ["Ma Societe", "MS", "https://cdn.test/logo.png"]);
});

test("the sync state records SUCCESS and lastSyncAt", async () => {
  const server = seededServer(uniqueOrg());
  const scope = scopeOf(server);
  const before = await state(scope);
  assert.equal(before.status, "IDLE");
  assert.equal(before.lastSyncAt, null);

  const c = clock();
  ok(await run(server, { now: c.now }));
  const after = await state(scope);
  assert.equal(after.status, "SUCCESS");
  assert.equal(after.lastSyncAt, new Date(T0).toISOString());
  assert.equal(after.lastError, null);
  assert.equal(after.startedAt, null);
  assert.equal(after.catalogueComplete, true);
  assert.equal(after.customersComplete, true);
  assert.deepEqual(after.lastSummary?.products, { total: 3, added: 3, updated: 0, removed: 0 });
});

test("only GET requests, same-origin, uncached", async () => {
  const server = seededServer(uniqueOrg());
  ok(await run(server));
  assert.ok(server.calls.length >= 4);
  for (const call of server.calls) {
    assert.equal(call.method, "GET");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.credentials, "same-origin");
  }
  assert.deepEqual(
    server.calls.map((call) => call.url),
    ["/api/auth/session", "/api/sales/context", "/api/customers", "/api/organization/identity"],
    "small catalogue: no catalogue pages, no stock endpoint",
  );
});

test("private data never reaches IndexedDB (customer contact/notes/balance, cost price, base64 photos)", async () => {
  const server = seededServer(uniqueOrg());
  server.products[0].imageUrl = "data:image/png;base64,AAAAAAAA";
  server.products[1].imageUrl = "https://cdn.test/p2.png";
  ok(await run(server));

  const db = getCounterPosDatabase(server.organizationId)!;
  const dump = JSON.stringify({
    products: await db.products.toArray(),
    customers: await db.customers.toArray(),
    contexts: await db.posContexts.toArray(),
  });
  for (const secret of ["prive@example.com", "12 rue Secrete", "note confidentielle", "987.65", "4.2137", "base64", "AAAAAAAA"]) {
    assert.ok(!dump.includes(secret), `${secret} must not be stored`);
  }
  const products = await db.products.toArray();
  assert.equal(products.find((p) => p.id === "p1")!.imageUrl, null, "raw data: photo is not stored");
  assert.equal(products.find((p) => p.id === "p2")!.imageUrl, "https://cdn.test/p2.png", "normal URL kept");
});

// ---------------------------------------------------------------------------
// second sync / idempotence / updates
// ---------------------------------------------------------------------------

test("second sync on unchanged data is idempotent: nothing added, updated or removed", async () => {
  const server = seededServer(uniqueOrg(), { products: 4, customers: 3 });
  const scope = scopeOf(server);
  const c = clock();
  ok(await run(server, { now: c.now }));
  const first = await cached(scope);

  c.advance(60_000);
  const second = ok(await run(server, { now: c.now }));
  assert.deepEqual(second.summary.products, { total: 4, added: 0, updated: 0, removed: 0 });
  assert.deepEqual(second.summary.customers, { total: 3, added: 0, updated: 0, removed: 0 });
  assert.deepEqual(await cached(scope), first, "same context, byte for byte");
  assert.equal((await state(scope)).lastSyncAt, new Date(T0 + 60_000).toISOString(), "only the timestamp moved");

  // and no duplicates in the tables
  const db = getCounterPosDatabase(scope.organizationId)!;
  assert.equal(await db.products.count(), 4);
  assert.equal(await db.customers.count(), 3);
  assert.equal(await db.stockLevels.count(), 4);
});

test("a changed product (price, name, barcode, stock) is updated in place", async () => {
  const server = seededServer(uniqueOrg(), { products: 3 });
  const scope = scopeOf(server);
  ok(await run(server));

  server.products[1] = { ...server.products[1], name: "Produit Renomme", salePrice: 12.5, barcode: "999", stock: 7, taxRate: 10 };
  const result = ok(await run(server));
  assert.deepEqual(result.summary.products, { total: 3, added: 0, updated: 1, removed: 0 });

  const p2 = (await cached(scope)).products.find((p) => p.id === "p2")!;
  assert.equal(p2.name, "Produit Renomme");
  assert.equal(p2.salePriceHT, 12.5);
  assert.equal(p2.salePriceTTC, 13.75, "TTC follows the new HT and tax");
  assert.equal(p2.taxRate, 10);
  assert.equal(p2.barcode, "999");
  assert.equal(p2.availableQuantity, 7);
});

test("a stock-only change refreshes the stock without counting a product update", async () => {
  const server = seededServer(uniqueOrg(), { products: 2 });
  const scope = scopeOf(server);
  ok(await run(server));
  server.products[0].stock = 999;
  const result = ok(await run(server));
  assert.equal(result.summary.products.updated, 0);
  assert.equal((await cached(scope)).products.find((p) => p.id === "p1")!.availableQuantity, 999);
});

test("a new product is added", async () => {
  const server = seededServer(uniqueOrg(), { products: 2 });
  ok(await run(server));
  server.products.push(makeProduct(3));
  const result = ok(await run(server));
  assert.deepEqual(result.summary.products, { total: 3, added: 1, updated: 0, removed: 0 });
});

// ---------------------------------------------------------------------------
// deactivations / deletions
// ---------------------------------------------------------------------------

test("a deactivated product disappears locally, with its stock row", async () => {
  const server = seededServer(uniqueOrg(), { products: 3 });
  const scope = scopeOf(server);
  ok(await run(server));

  server.products[1].status = "INACTIVE";
  const result = ok(await run(server));
  assert.deepEqual(result.summary.products, { total: 2, added: 0, updated: 0, removed: 1 });
  assert.deepEqual((await cached(scope)).products.map((p) => p.id), ["p1", "p3"]);
  const db = getCounterPosDatabase(scope.organizationId)!;
  assert.equal(await db.stockLevels.count(), 2);
  assert.equal(await db.products.get([scope.organizationId, "p2"]), undefined);
});

test("a deleted product disappears locally too", async () => {
  const server = seededServer(uniqueOrg(), { products: 3 });
  const scope = scopeOf(server);
  ok(await run(server));
  server.products = server.products.filter((p) => p.id !== "p3");
  ok(await run(server));
  assert.deepEqual((await cached(scope)).products.map((p) => p.id), ["p1", "p2"]);
});

test("a reactivated product comes back", async () => {
  const server = seededServer(uniqueOrg(), { products: 2 });
  const scope = scopeOf(server);
  server.products[1].status = "INACTIVE";
  ok(await run(server));
  assert.deepEqual((await cached(scope)).products.map((p) => p.id), ["p1"]);
  server.products[1].status = "ACTIVE";
  const result = ok(await run(server));
  assert.equal(result.summary.products.added, 1);
  assert.deepEqual((await cached(scope)).products.map((p) => p.id), ["p1", "p2"]);
});

// ---------------------------------------------------------------------------
// customers
// ---------------------------------------------------------------------------

test("customers: added, modified, deactivated and deleted are all reflected", async () => {
  const server = seededServer(uniqueOrg(), { products: 1, customers: 3 });
  const scope = scopeOf(server);
  ok(await run(server));
  assert.deepEqual((await cached(scope)).customers.map((cu) => cu.id), ["c1", "c2", "c3"]);

  server.customers.push(makeCustomer(4)); // added
  server.customers[1] = { ...server.customers[1], name: "Client Renomme", creditLimit: 5000, phone: "0611111111", city: "Fes" }; // modified
  server.customers[2].status = "BLOCKED"; // deactivated
  const result = ok(await run(server));
  assert.deepEqual(result.summary.customers, { total: 3, added: 1, updated: 1, removed: 1 });

  const customers = (await cached(scope)).customers;
  assert.deepEqual(customers.map((cu) => cu.id).sort(), ["c1", "c2", "c4"]);
  const c2 = customers.find((cu) => cu.id === "c2")!;
  assert.deepEqual([c2.name, c2.creditLimit, c2.phone, c2.city], ["Client Renomme", 5000, "0611111111", "Fes"]);

  server.customers = server.customers.filter((cu) => cu.id !== "c4"); // deleted
  ok(await run(server));
  assert.deepEqual((await cached(scope)).customers.map((cu) => cu.id).sort(), ["c1", "c2"]);
});

test("customers beyond the 20-customer context preload are downloaded", async () => {
  const server = seededServer(uniqueOrg(), { products: 1, customers: 60 });
  const scope = scopeOf(server);
  const result = ok(await run(server));
  assert.equal(result.summary.customers.total, 60);
  assert.equal((await cached(scope)).customers.length, 60);
});

test("a failed customer list keeps the cached customers and warns (no purge)", async () => {
  const server = seededServer(uniqueOrg(), { products: 1, customers: 3 });
  const scope = scopeOf(server);
  ok(await run(server));

  server.customers = server.customers.filter((cu) => cu.id !== "c3");
  server.inject("/api/customers", { status: 500, body: { message: "boom" } });
  const result = ok(await run(server));
  assert.equal(result.customersComplete, false);
  assert.deepEqual(result.warnings.map((w) => w.code), ["CUSTOMERS_INCOMPLETE"]);
  assert.equal(result.summary.customers.removed, 0);
  assert.equal((await cached(scope)).customers.length, 3, "c3 kept: absence proves nothing");
  assert.equal((await state(scope)).customersComplete, false);

  server.clearInjections();
  const healed = ok(await run(server));
  assert.equal(healed.customersComplete, true);
  assert.equal(healed.summary.customers.removed, 1);
  assert.equal((await cached(scope)).customers.length, 2);
});

test("a full customer list that lacks the default customer is not trusted", async () => {
  const server = seededServer(uniqueOrg(), { products: 1, customers: 3 });
  const scope = scopeOf(server);
  ok(await run(server));
  // c1 is the default but the (broken) full list omits it.
  server.inject("/api/customers", { status: 200, body: { customers: [{ ...makeCustomerJson(2) }, { ...makeCustomerJson(3) }] } });
  const result = ok(await run(server));
  assert.deepEqual(result.warnings.map((w) => w.code), ["CUSTOMERS_INCOMPLETE"]);
  assert.equal((await cached(scope)).customers.length, 3, "nothing deleted");
});

function makeCustomerJson(n: number) {
  const c = makeCustomer(n);
  return { id: c.id, code: c.code, displayCode: c.displayCode, name: c.name, phone: c.phone, city: "X", type: "RETAIL", status: "ACTIVE", creditLimit: 0, creditLimitEnabled: false };
}

// ---------------------------------------------------------------------------
// no Internet / network errors
// ---------------------------------------------------------------------------

test("OFFLINE: no request at all, nothing changes, the failure is recorded and retryable", async () => {
  const server = seededServer(uniqueOrg());
  const scope = scopeOf(server);
  const c = clock();
  ok(await run(server, { now: c.now }));
  const before = await cached(scope);
  server.calls.length = 0;

  c.advance(3_600_000);
  server.products.push(makeProduct(9)); // the server changed, but we are offline
  const result = failed(await run(server, { now: c.now, getNetworkState: async () => "OFFLINE" }));

  assert.equal(result.code, "OFFLINE");
  assert.equal(result.retryable, true);
  assert.equal(server.calls.length, 0, "no request while offline");
  assert.deepEqual(await cached(scope), before, "the POS keeps working from what it has");

  const after = await state(scope);
  assert.equal(after.status, "FAILED");
  assert.equal(after.lastError?.code, "OFFLINE");
  assert.equal(after.lastError?.retryable, true);
  assert.equal(after.lastSyncAt, new Date(T0).toISOString(), "lastSyncAt is still the last SUCCESS");
  assert.equal(after.lastAttemptAt, new Date(T0 + 3_600_000).toISOString());
  assert.equal(after.lastSummary?.products.total, 3, "previous summary kept");
  assert.equal(effectiveSyncStatus(after, new Date(T0 + 3_600_000)), "FAILED");
});

test("SERVER_UNREACHABLE (network up, server down): no request, retryable", async () => {
  const server = seededServer(uniqueOrg());
  const result = failed(await run(server, { getNetworkState: async () => "SERVER_UNREACHABLE" }));
  assert.equal(result.code, "SERVER_UNREACHABLE");
  assert.equal(result.retryable, true);
  assert.equal(server.calls.length, 0);
});

test("the connection drops mid-sync: nothing is written, the old data survives", async () => {
  const server = seededServer(uniqueOrg(), { products: 3, customers: 2 });
  const scope = scopeOf(server);
  ok(await run(server));
  const before = await cached(scope);

  server.products.push(makeProduct(7));
  server.products[0].salePrice = 99;
  // session + context succeed, then the network dies during the customer list.
  server.inject("/api/customers", { throw: new TypeError("Failed to fetch") });
  server.inject("/api/organization/identity", { throw: new TypeError("Failed to fetch") });
  const result = ok(await run(server)); // customers/identity are non-essential: a warning
  assert.deepEqual(result.warnings.map((w) => w.code), ["CUSTOMERS_INCOMPLETE", "ORGANIZATION_INFO_UNAVAILABLE"]);

  // ...whereas losing the ESSENTIAL context request writes NOTHING.
  server.clearInjections();
  server.products[0].salePrice = 55;
  const midway = await cached(scope);
  server.inject("/api/sales/context", { throw: new TypeError("Failed to fetch") });
  const lost = failed(await run(server));
  assert.equal(lost.code, "NETWORK");
  assert.equal(lost.retryable, true);
  assert.deepEqual(await cached(scope), midway, "a failed sync writes nothing");
  assert.notDeepEqual(midway, before);
});

test("error taxonomy: timeout, HTML page, 500, 401, 403, bad JSON, invalid shape", async () => {
  const cases: Array<{
    name: string;
    inject: Parameters<FakeServer["inject"]>[1];
    code: string;
    retryable: boolean;
    extra?: SyncPosDataDeps;
  }> = [
    { name: "timeout", inject: { hang: true }, code: "TIMEOUT", retryable: true, extra: { requestTimeoutMs: 25 } },
    { name: "captive portal", inject: { status: 200, body: "<html>login</html>", contentType: "text/html" }, code: "SERVER_UNREACHABLE", retryable: true },
    { name: "500", inject: { status: 500, body: { message: "boom" } }, code: "SERVER_ERROR", retryable: true },
    { name: "429", inject: { status: 429, body: {} }, code: "SERVER_ERROR", retryable: true },
    { name: "401", inject: { status: 401, body: { message: "no" } }, code: "AUTH_REQUIRED", retryable: false },
    { name: "403", inject: { status: 403, body: { message: "no" } }, code: "FORBIDDEN", retryable: false },
    { name: "400", inject: { status: 400, body: { message: "bad" } }, code: "SERVER_ERROR", retryable: false },
    { name: "not json", inject: { status: 200, body: "{oops", contentType: "application/json" }, code: "INVALID_RESPONSE", retryable: false },
    { name: "wrong shape", inject: { status: 200, body: { context: { canSell: "yes" } } }, code: "INVALID_RESPONSE", retryable: false },
  ];
  for (const testCase of cases) {
    const server = seededServer(uniqueOrg());
    const scope = scopeOf(server);
    server.inject("/api/sales/context", testCase.inject);
    const result = failed(await run(server, testCase.extra));
    assert.equal(result.code, testCase.code, testCase.name);
    assert.equal(result.retryable, testCase.retryable, testCase.name);
    assert.deepEqual(await loadCachedCounterPosContext(scope), { ok: false, reason: "NOT_FOUND" }, `${testCase.name}: nothing written`);
    const recorded = await state(scope);
    assert.equal(recorded.status, "FAILED", testCase.name);
    assert.equal(recorded.lastError?.code, testCase.code, testCase.name);
  }
});

test("an expired session mid-sync (401 after the context) aborts EVERYTHING", async () => {
  const server = seededServer(uniqueOrg(), { products: 3, customers: 3 });
  const scope = scopeOf(server);
  ok(await run(server));
  const before = await cached(scope);

  server.products[0].salePrice = 77; // would be visible if the context were applied
  server.inject("/api/customers", { status: 401, body: { message: "expired" } });
  const result = failed(await run(server));
  assert.equal(result.code, "AUTH_REQUIRED");
  assert.equal(result.retryable, false);
  assert.deepEqual(await cached(scope), before, "the context fetched before the 401 was NOT applied");
});

// ---------------------------------------------------------------------------
// organization / user isolation and identity
// ---------------------------------------------------------------------------

test("organization isolation: two organizations sync into two separate databases", async () => {
  const serverA = seededServer(uniqueOrg("A"), { products: 3, customers: 2 });
  const serverB = seededServer(uniqueOrg("B"), { products: 5, customers: 4 });
  serverB.products = serverB.products.map((p) => ({ ...p, name: `B-${p.name}`, salePrice: 99 }));
  serverB.identity = { name: "Societe B", tradeName: null, logoUrl: null };
  serverA.identity = { name: "Societe A", tradeName: null, logoUrl: null };

  ok(await run(serverA));
  ok(await run(serverB));

  const contextA = await cached(scopeOf(serverA));
  const contextB = await cached(scopeOf(serverB));
  assert.equal(contextA.products.length, 3);
  assert.equal(contextB.products.length, 5);
  assert.ok(contextA.products.every((p) => !p.name.startsWith("B-") && p.salePriceHT === 10));
  assert.ok(contextB.products.every((p) => p.name.startsWith("B-") && p.salePriceHT === 99));
  assert.equal(unwrap(await getOrganizationInfo(serverA.organizationId))?.name, "Societe A");
  assert.equal(unwrap(await getOrganizationInfo(serverB.organizationId))?.name, "Societe B");

  // Deleting/deactivating in B never touches A.
  serverB.products = [];
  ok(await run(serverB));
  assert.equal((await cached(scopeOf(serverA))).products.length, 3);
  const dbA = getCounterPosDatabase(serverA.organizationId)!;
  assert.ok((await dbA.products.toArray()).every((p) => p.organizationId === serverA.organizationId));
});

test("identity guard: a session of ANOTHER ORGANIZATION aborts before anything is downloaded or written", async () => {
  const orgA = uniqueOrg("A");
  const server = seededServer(orgA);
  const scope = scopeOf(server);
  ok(await run(server));
  const before = await cached(scope);
  server.calls.length = 0;

  // Someone logged into organization B in another tab: the cookie is now B's.
  server.sessionOverride = { id: "user-1", role: "cashier", organizationId: uniqueOrg("B") };
  server.products[0].salePrice = 1234;
  const result = failed(await run(server));
  assert.equal(result.code, "IDENTITY_MISMATCH");
  assert.equal(result.retryable, false);
  assert.deepEqual(server.calls.map((call) => call.url), ["/api/auth/session"], "stopped at the guard");
  assert.deepEqual(await cached(scope), before);
});

test("identity guard: another USER's session is refused too", async () => {
  const server = seededServer(uniqueOrg());
  server.sessionOverride = { id: "someone-else", role: "cashier", organizationId: server.organizationId };
  const result = failed(await run(server));
  assert.equal(result.code, "IDENTITY_MISMATCH");
  assert.deepEqual(await loadCachedCounterPosContext(scopeOf(server)), { ok: false, reason: "NOT_FOUND" });
});

test("identity guard: no session, and a role that cannot use the counter POS", async () => {
  const server = seededServer(uniqueOrg());
  server.sessionOverride = null;
  assert.equal(failed(await run(server)).code, "AUTH_REQUIRED");
  server.sessionOverride = { id: "user-1", role: "driver", organizationId: server.organizationId };
  assert.equal(failed(await run(server)).code, "FORBIDDEN");
  server.sessionOverride = { id: "user-1", role: "admin", organizationId: server.organizationId };
  ok(await run(server));
});

test("a context that belongs to another user, or an identity of another organization, aborts the whole sync", async () => {
  const server = seededServer(uniqueOrg());
  const scope = scopeOf(server);

  server.contextUserIdOverride = "someone-else";
  assert.equal(failed(await run(server)).code, "IDENTITY_MISMATCH");
  server.contextUserIdOverride = undefined;

  server.identityIdOverride = uniqueOrg("other");
  const result = failed(await run(server));
  assert.equal(result.code, "IDENTITY_MISMATCH", "fatal even though identity is otherwise non-essential");
  assert.deepEqual(await loadCachedCounterPosContext(scope), { ok: false, reason: "NOT_FOUND" }, "nothing written");
});

test("a failed identity request is only a warning; the old organization info is kept", async () => {
  const server = seededServer(uniqueOrg());
  const scope = scopeOf(server);
  server.identity = { name: "Ancien Nom", tradeName: null, logoUrl: null };
  ok(await run(server));
  server.identity = { name: "Nouveau Nom", tradeName: null, logoUrl: null };
  server.inject("/api/organization/identity", { status: 500, body: {} });
  const result = ok(await run(server));
  assert.deepEqual(result.warnings.map((w) => w.code), ["ORGANIZATION_INFO_UNAVAILABLE"]);
  assert.equal(unwrap(await getOrganizationInfo(scope.organizationId))?.name, "Ancien Nom");
});

test("two users of one organization: the catalogue is shared, each gets their own POS context", async () => {
  const org = uniqueOrg();
  const alice = seededServer(org, { products: 3 });
  const bob = new FakeServer(org, "user-2", "depot_manager", "loc-2");
  bob.products = alice.products.map((p) => ({ ...p, stock: 500 })); // Bob's depot
  bob.customers = alice.customers;
  bob.defaultCustomerId = "c1";

  ok(await run(alice));
  ok(await run(bob));

  const a = await cached(scopeOf(alice));
  const b = await cached(scopeOf(bob));
  assert.equal(a.stockLocation.id, "loc-1");
  assert.equal(b.stockLocation.id, "loc-2");
  assert.equal(a.products[0].availableQuantity, 10);
  assert.equal(b.products[0].availableQuantity, 500);
  assert.equal(a.products.length, b.products.length);
  assert.equal((await state(scopeOf(alice))).userId, "user-1");
  assert.equal((await state(scopeOf(bob))).userId, "user-2");
});

// ---------------------------------------------------------------------------
// catalogue larger than the 500-product context
// ---------------------------------------------------------------------------

function bigCatalogueServer(count: number) {
  const server = seededServer(uniqueOrg(), { products: count, customers: 2 });
  server.contextProductCap = 3; // stand-in for the real 500
  return server;
}

test("a truncated context triggers the full paged catalogue, with depot stock joined", async () => {
  const server = bigCatalogueServer(7);
  server.products[4].stock = undefined; // no stock row -> 0
  server.foreignStock = [{ productId: "p1", locationId: "loc-OTHER", availableQuantity: 5000 }];
  const scope = scopeOf(server);

  const result = ok(await run(server, { pageSize: 2 }));
  assert.equal(result.summary.catalogueSource, "catalogue-pages");
  assert.equal(result.catalogueComplete, true);
  assert.deepEqual(result.summary.products, { total: 7, added: 7, updated: 0, removed: 0 });
  assert.equal(server.callsTo("/api/products/list"), 4, "7 products / pages of 2");
  assert.equal(server.callsTo("/api/stock/locations/loc-1"), 1);

  const context = await cached(scope);
  assert.equal(context.products.length, 7);
  assert.equal(context.productsTruncated, false, "the local catalogue is complete");
  const byId = new Map(context.products.map((p) => [p.id, p]));
  assert.equal(byId.get("p1")!.availableQuantity, 10, "another depot's stock is ignored");
  assert.equal(byId.get("p5")!.availableQuantity, 0, "no stock row = 0");
  assert.equal(byId.get("p7")!.salePriceTTC, 12);
  assert.equal(byId.get("p7")!.supplierName, "Fournisseur Un");
  const db = getCounterPosDatabase(scope.organizationId)!;
  assert.ok(!JSON.stringify(await db.products.toArray()).includes("4.2137"), "cost price not stored");
});

test("with the full catalogue, deactivations are detected beyond the first 500", async () => {
  const server = bigCatalogueServer(7);
  const scope = scopeOf(server);
  ok(await run(server, { pageSize: 2 }));
  server.products[6].status = "INACTIVE"; // p7 is NOT in the (name-ordered) context slice
  const result = ok(await run(server, { pageSize: 2 }));
  assert.deepEqual(result.summary.products, { total: 6, added: 0, updated: 0, removed: 1 });
  assert.ok(!(await cached(scope)).products.some((p) => p.id === "p7"));
});

test("if the catalogue pages fail, the context part is refreshed but NOTHING is deleted, with a warning", async () => {
  const server = bigCatalogueServer(7);
  const scope = scopeOf(server);
  ok(await run(server, { pageSize: 2 }));

  server.products[0].salePrice = 42; // in the context slice: will be refreshed
  server.products[6].status = "INACTIVE"; // outside it: cannot be known to be gone
  server.inject("/api/products/list", { status: 500, body: {} });
  const result = ok(await run(server, { pageSize: 2 }));
  assert.equal(result.catalogueComplete, false);
  assert.deepEqual(result.warnings.map((w) => w.code), ["CATALOGUE_INCOMPLETE"]);
  assert.equal(result.summary.catalogueSource, "context");
  assert.equal(result.summary.products.removed, 0);

  const context = await cached(scope);
  assert.equal(context.products.length, 7, "no product deleted");
  assert.equal(context.products.find((p) => p.id === "p1")!.salePriceHT, 42, "the context slice was refreshed");
  assert.equal(context.productsTruncated, true);
  assert.equal((await state(scope)).catalogueComplete, false);
});

test("a pagination that does not advance is refused", async () => {
  const server = bigCatalogueServer(7);
  const stuck = { items: [], nextCursor: "same", hasMore: true, totalCount: 7 };
  server.inject("/api/products/list", { status: 200, body: stuck });
  const result = ok(await run(server, { pageSize: 2 }));
  assert.deepEqual(result.warnings.map((w) => w.code), ["CATALOGUE_INCOMPLETE"]);
  assert.ok(result.warnings[0].message.includes("pagination"));
});

// ---------------------------------------------------------------------------
// limits and hostile input
// ---------------------------------------------------------------------------

test("oversized downloads are refused before anything is written", async () => {
  const server = seededServer(uniqueOrg(), { products: 5, customers: 2 });
  const result = failed(await run(server, { maxProducts: 4 }));
  assert.equal(result.code, "TOO_LARGE");
  assert.deepEqual(await loadCachedCounterPosContext(scopeOf(server)), { ok: false, reason: "NOT_FOUND" });

  // A context whose own customer preload is over the cap is fatal...
  const preloadTooBig = seededServer(uniqueOrg(), { products: 1, customers: 6 });
  assert.equal(failed(await run(preloadTooBig, { maxCustomers: 5 })).code, "TOO_LARGE");

  // ...but a FULL customer list over the cap (preload = 21, full = 30) only degrades to a warning.
  const many = seededServer(uniqueOrg(), { products: 1, customers: 30 });
  const degraded = ok(await run(many, { maxCustomers: 25 }));
  assert.deepEqual(degraded.warnings.map((w) => w.code), ["CUSTOMERS_INCOMPLETE"]);
  assert.equal(degraded.customersComplete, false);
});

test("an EMPTY server catalogue never wipes a populated cache", async () => {
  const server = seededServer(uniqueOrg(), { products: 3, customers: 2 });
  const scope = scopeOf(server);
  ok(await run(server));
  server.products = [];
  const result = ok(await run(server));
  assert.equal(result.summary.products.removed, 0);
  assert.equal((await cached(scope)).products.length, 3);
});

test("a hostile payload cannot smuggle extra data or bad numbers in", async () => {
  const server = seededServer(uniqueOrg());
  const scope = scopeOf(server);
  server.inject("/api/customers", {
    status: 200,
    body: { customers: [{ ...makeCustomerJson(1), creditLimit: "1000" }] }, // string, not number
  });
  const result = ok(await run(server));
  assert.deepEqual(result.warnings.map((w) => w.code), ["CUSTOMERS_INCOMPLETE"], "an invalid customer list is not applied");
  assert.equal((await cached(scope)).customers.length, 2);

  const negative = seededServer(uniqueOrg());
  negative.products[0].salePrice = -5;
  assert.equal(failed(await run(negative)).code, "INVALID_RESPONSE");
});

// ---------------------------------------------------------------------------
// concurrency, bookkeeping, coexistence with offline sales
// ---------------------------------------------------------------------------

test("concurrent calls share ONE run", async () => {
  const server = seededServer(uniqueOrg());
  const scope = scopeOf(server);
  const results = await Promise.all([run(server), run(server), run(server)]);
  assert.equal(server.callsTo("/api/sales/context"), 1, "a single download");
  assert.equal(results[0], results[1]);
  assert.equal(results[1], results[2]);
  assert.equal(isPosSyncRunning(scope), false, "released afterwards");
  ok(await run(server));
  assert.equal(server.callsTo("/api/sales/context"), 2, "a later call runs again");
});

test("the sync state: started is persisted, a stale SYNCING is reported as FAILED", async () => {
  const org = uniqueOrg();
  const scope = { organizationId: org, userId: "user-1" };
  const t = new Date(T0);
  const started = unwrap(await markPosSyncStarted(scope, t));
  assert.equal(started.status, "SYNCING");
  assert.equal(started.startedAt, t.toISOString());
  assert.equal(effectiveSyncStatus(started, new Date(T0 + 60_000)), "SYNCING");
  assert.equal(effectiveSyncStatus(started, new Date(T0 + 11 * 60_000)), "FAILED");
  assert.equal((await state(scope)).status, "SYNCING");
});

test("invalid scopes and a missing IndexedDB fail softly", async () => {
  const server = seededServer(uniqueOrg());
  assert.equal(failed(await run(server, {}, { organizationId: "", userId: "u" })).code, "INVALID_INPUT");
  assert.equal(failed(await run(server, {}, { organizationId: "o", userId: "" })).code, "INVALID_INPUT");

  const original = globalThis.indexedDB;
  // @ts-expect-error simulating an environment without IndexedDB
  delete globalThis.indexedDB;
  try {
    assert.equal(failed(await run(server)).code, "INDEXEDDB_UNAVAILABLE");
  } finally {
    globalThis.indexedDB = original;
  }
});

test("syncing leaves offline sales and carts alone, and the displayed stock still subtracts them", async () => {
  const server = seededServer(uniqueOrg(), { products: 2 });
  const scope = scopeOf(server);
  ok(await run(server));

  const { sale } = unwrap(
    await createOfflineSale(scope, makeSaleInput([makeLine("p1", 4)], { idempotencyKey: "keep-me" })),
  );
  server.products[0].stock = 50; // the server value moved; this sale is not synced yet
  ok(await run(server));

  const db = getCounterPosDatabase(scope.organizationId)!;
  const stored = await db.offlineSales.get(sale.localId);
  assert.equal(stored?.status, "PENDING");
  assert.equal(stored?.idempotencyKey, "keep-me");
  assert.equal(await db.offlineSaleLines.count(), 1);

  const shown = await loadCachedCounterPosContext(scope); // pending sales applied by default
  assert.equal(shown.ok && shown.context.products.find((p) => p.id === "p1")!.availableQuantity, 46, "50 (server) - 4 (this PC's pending sale)");
});

// ---------------------------------------------------------------------------
// automatic refresh
// ---------------------------------------------------------------------------

function autoHarness(initial: Partial<SyncStateRecord> | null, overrides: Partial<PosAutoSyncOptions> = {}) {
  const scope: CounterPosScope = { organizationId: "org-auto", userId: "user-1" };
  const c = clock();
  let listener: ((state: "ONLINE" | "OFFLINE" | "SERVER_UNREACHABLE") => void) | null = null;
  const syncs: number[] = [];
  let unsubscribed = false;
  let current: SyncStateRecord = {
    organizationId: scope.organizationId,
    userId: scope.userId,
    status: "IDLE",
    startedAt: null,
    lastAttemptAt: null,
    lastSyncAt: null,
    lastError: null,
    warnings: [],
    lastSummary: null,
    catalogueComplete: false,
    customersComplete: false,
    updatedAt: new Date(T0).toISOString(),
    ...initial,
  };
  const options: PosAutoSyncOptions = {
    minIntervalMs: 10 * 60_000,
    retryAfterFailureMs: 60_000,
    checkEveryMs: 0,
    now: c.now,
    subscribe: (cb) => {
      listener = cb;
      return () => {
        unsubscribed = true;
      };
    },
    readState: async () => ({ ok: true, value: current }),
    sync: async () => {
      syncs.push(c.now().getTime());
      return { ok: true, syncedAt: c.now().toISOString(), summary: {} as never, warnings: [], catalogueComplete: true, customersComplete: true };
    },
    ...overrides,
  };
  const stop = startPosDataAutoSync(scope, options);
  const emit = async (state: "ONLINE" | "OFFLINE" | "SERVER_UNREACHABLE") => {
    listener?.(state);
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  return {
    c,
    syncs,
    emit,
    stop,
    setState: (next: Partial<SyncStateRecord>) => (current = { ...current, ...next }),
    isUnsubscribed: () => unsubscribed,
  };
}

test("auto-sync: syncs when the PC is (back) online and never syncs while offline", async () => {
  const h = autoHarness(null);
  await h.emit("OFFLINE");
  assert.equal(h.syncs.length, 0);
  await h.emit("SERVER_UNREACHABLE");
  assert.equal(h.syncs.length, 0);
  await h.emit("ONLINE");
  assert.equal(h.syncs.length, 1, "first sync as soon as it is online");
  h.stop();
});

test("auto-sync: fresh data is not re-downloaded; stale data is", async () => {
  const h = autoHarness({ status: "SUCCESS", lastSyncAt: new Date(T0 - 60_000).toISOString(), lastAttemptAt: new Date(T0 - 60_000).toISOString() });
  await h.emit("ONLINE");
  assert.equal(h.syncs.length, 0, "1 minute old < 10 minutes");
  h.c.advance(11 * 60_000);
  await h.emit("OFFLINE");
  await h.emit("ONLINE");
  assert.equal(h.syncs.length, 1, "now stale");
  h.stop();
});

test("auto-sync: a retryable failure waits retryAfterFailureMs; a permanent one waits minIntervalMs", async () => {
  const failedState = (retryable: boolean): Partial<SyncStateRecord> => ({
    status: "FAILED",
    lastSyncAt: new Date(T0 - 3_600_000).toISOString(),
    lastAttemptAt: new Date(T0).toISOString(),
    lastError: { code: "X", message: "x", retryable, httpStatus: null, at: new Date(T0).toISOString() },
  });

  const retryable = autoHarness(failedState(true));
  await retryable.emit("ONLINE");
  assert.equal(retryable.syncs.length, 0, "too soon after a failure");
  retryable.c.advance(61_000);
  await retryable.emit("OFFLINE");
  await retryable.emit("ONLINE");
  assert.equal(retryable.syncs.length, 1);
  retryable.stop();

  const permanent = autoHarness(failedState(false));
  permanent.c.advance(5 * 60_000);
  await permanent.emit("ONLINE");
  assert.equal(permanent.syncs.length, 0, "an expired session is not hammered every minute");
  permanent.c.advance(6 * 60_000);
  await permanent.emit("OFFLINE");
  await permanent.emit("ONLINE");
  assert.equal(permanent.syncs.length, 1);
  permanent.stop();
});

test("auto-sync: an attempt already running is left alone, and stop() halts everything", async () => {
  const running = autoHarness({ status: "SYNCING", startedAt: new Date(T0 - 30_000).toISOString() });
  await running.emit("ONLINE");
  assert.equal(running.syncs.length, 0);
  running.stop();

  const h = autoHarness(null);
  h.stop();
  assert.equal(h.isUnsubscribed(), true);
  await h.emit("ONLINE");
  assert.equal(h.syncs.length, 0, "nothing after stop()");
});

test("auto-sync: reports each result through onResult, and never overlaps two syncs", async () => {
  const results: SyncPosDataResult[] = [];
  let release: (() => void) | null = null;
  let started = 0;
  const h = autoHarness(null, {
    onResult: (r) => results.push(r),
    sync: async () => {
      started += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: false, code: "NETWORK", message: "x", retryable: true, httpStatus: null };
    },
  });
  await h.emit("ONLINE");
  await h.emit("OFFLINE");
  await h.emit("ONLINE"); // while the first is still in flight
  assert.equal(started, 1, "no overlap");
  (release as (() => void) | null)?.();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  h.stop();
});

test("the catalogue page size matches the server's clamp", () => {
  assert.equal(CATALOGUE_PAGE_SIZE, 100);
});
