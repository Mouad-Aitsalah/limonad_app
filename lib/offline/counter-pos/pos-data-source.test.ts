import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CounterPosContextDto } from "@/types/operations-dto";

import { closeCounterPosDatabase, getCounterPosDatabase } from "./database";
import { getOrganizationInfo } from "./profile-store";
import {
  applyPendingSalesToContext,
  CounterPosContextFetchError,
  customerDtoFromRecord,
  customerRecordFromDto,
  hydrateCounterPosSnapshot,
  loadCachedCounterPosContext,
  loadCounterPosContext,
} from "./pos-data-source";
import {
  claimSaleForSync,
  createOfflineSale,
  markSaleSynced,
  markSaleSyncFailure,
} from "./sales-store";
import { makeContext, makeLine, makeSaleInput, uniqueOrg, unwrap } from "./test-helpers";

const T0 = new Date("2026-09-25T10:00:00.000Z");

function scopeFor(org: string, userId = "user-1") {
  return { organizationId: org, userId };
}

const withProducts = (context: CounterPosContextDto, ids: string[]): CounterPosContextDto => ({
  ...context,
  products: context.products.filter((p) => ids.includes(p.id)),
});

// ---------------------------------------------------------------------------
// snapshot round trip
// ---------------------------------------------------------------------------

test("hydrate then load rebuilds the same context the server gave", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const context = makeContext();
  const summary = unwrap(await hydrateCounterPosSnapshot(scope, context, { now: T0 }));
  assert.deepEqual(summary, {
    products: { total: 3, added: 3, updated: 0, removed: 0 },
    customers: { total: 2, added: 2, updated: 0, removed: 0 },
    stockLevels: 3,
    purgedMissingProducts: true,
    purgedMissingCustomers: false,
  });

  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok, true);
  if (!cached.ok) return;
  assert.equal(cached.syncedAt, T0.toISOString());
  assert.deepEqual(cached.counts, { products: 3, customers: 2, stockLevels: 3 });

  const rebuilt = cached.context;
  assert.equal(rebuilt.canSell, true);
  assert.deepEqual(rebuilt.user, context.user);
  assert.deepEqual(rebuilt.depot, context.depot);
  assert.deepEqual(rebuilt.stockLocation, context.stockLocation);
  assert.equal(rebuilt.defaultCustomerId, "cust-1");
  assert.equal(rebuilt.productsTruncated, false);
  assert.deepEqual(rebuilt.bankAccounts, context.bankAccounts);

  // Products come back in name order with prices, tax, stock and supplier intact.
  assert.deepEqual(rebuilt.products.map((p) => p.name), ["Coca 1L", "Eau 5L", "Fanta 1L"]);
  const coca = rebuilt.products.find((p) => p.id === "p1")!;
  assert.deepEqual(
    { ...coca },
    { ...context.products[0], barcode: "611000000001", imageUrl: null, supplierLogoUrl: null },
  );
  assert.equal(rebuilt.products.find((p) => p.id === "p2")!.availableQuantity, 0);
  assert.equal(rebuilt.products.find((p) => p.id === "p3")!.taxRate, 10);
});

test("customers keep what the POS needs, and NOT the private fields", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext(), { now: T0 }));

  const db = getCounterPosDatabase(org)!;
  const stored = await db.customers.get([org, "cust-1"]);
  assert.ok(stored);
  const serialized = JSON.stringify(stored);
  for (const secret of ["secret@example.com", "1 rue Privee", "note privee", "1234.5"]) {
    assert.ok(!serialized.includes(secret), `${secret} must not be stored locally`);
  }

  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok, true);
  if (!cached.ok) return;
  const customer = cached.context.customers.find((c) => c.id === "cust-1")!;
  assert.equal(customer.displayCode, "3421/1");
  assert.equal(customer.name, "Client Un");
  assert.equal(customer.phone, "0600000001");
  assert.equal(customer.creditLimit, 5000);
  assert.equal(customer.creditLimitEnabled, true);
  assert.equal(customer.currentBalance, 0, "the cached balance is never reconstructed");
  assert.equal(customer.creationOrigin, "CACHE");
});

test("customerRecord/Dto mapping keeps the fields the POS displays", () => {
  const dto = makeContext().customers[1];
  const record = customerRecordFromDto("org-x", dto, T0.toISOString());
  assert.equal(record.organizationId, "org-x");
  assert.equal(record.phone, null);
  assert.equal(customerDtoFromRecord(record).city, "Rabat");
});

test("no snapshot yet -> NOT_FOUND (never an empty invented context)", async () => {
  const result = await loadCachedCounterPosContext(scopeFor(uniqueOrg()));
  assert.deepEqual(result, { ok: false, reason: "NOT_FOUND" });
});

test("a malformed server context is refused and writes nothing", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  const broken = { ...makeContext(), stockLocation: undefined } as unknown as CounterPosContextDto;
  const result = await hydrateCounterPosSnapshot(scope, broken);
  assert.equal(result.ok, false);
  assert.deepEqual(await loadCachedCounterPosContext(scope), { ok: false, reason: "NOT_FOUND" });
});

test("organization info is saved with the snapshot when the caller has it", async () => {
  const org = uniqueOrg();
  unwrap(
    await hydrateCounterPosSnapshot(scopeFor(org), makeContext(), {
      now: T0,
      organization: { name: "Ma Societe", logoUrl: "data:image/png;base64,AAAA" },
    }),
  );
  const info = unwrap(await getOrganizationInfo(org));
  assert.equal(info?.name, "Ma Societe");
  assert.equal(info?.syncedAt, T0.toISOString());
});

// ---------------------------------------------------------------------------
// snapshot reconciliation rules
// ---------------------------------------------------------------------------

test("a complete context removes products (and their stock) the server no longer lists", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext()));
  const summary = unwrap(await hydrateCounterPosSnapshot(scope, withProducts(makeContext(), ["p1", "p3"])));
  assert.equal(summary.purgedMissingProducts, true);

  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok, true);
  if (!cached.ok) return;
  assert.deepEqual(cached.context.products.map((p) => p.id).sort(), ["p1", "p3"]);
  assert.equal(await getCounterPosDatabase(org)!.stockLevels.count(), 2);
});

test("a TRUNCATED context never deletes anything (absence proves nothing)", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext()));
  const summary = unwrap(
    await hydrateCounterPosSnapshot(scope, { ...withProducts(makeContext(), ["p1"]), productsTruncated: true }),
  );
  assert.equal(summary.purgedMissingProducts, false);
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok && cached.context.products.length, 3);
  assert.equal(cached.ok && cached.context.productsTruncated, true);
});

test("an EMPTY incoming catalogue never purges a non-empty cache", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext()));
  const summary = unwrap(
    await hydrateCounterPosSnapshot(scope, { ...makeContext(), products: [], canSell: false, message: "Aucun produit." }),
  );
  assert.equal(summary.purgedMissingProducts, false);
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok && cached.context.products.length, 3, "catalogue preserved");
  assert.equal(cached.ok && cached.context.canSell, false, "but the server's verdict is recorded");
  assert.equal(cached.ok && cached.context.message, "Aucun produit.");
});

test("customers are only ever upserted (the preload is partial by design)", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext()));
  const onlyOne = { ...makeContext(), customers: [makeContext().customers[1]], defaultCustomerId: "cust-2" };
  unwrap(await hydrateCounterPosSnapshot(scope, onlyOne));
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok && cached.context.customers.length, 2, "cust-1 kept");
  assert.equal(cached.ok && cached.context.defaultCustomerId, "cust-2");
});

test("a refreshed price replaces the old one", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext(), { now: T0 }));
  const repriced = makeContext();
  repriced.products[0] = { ...repriced.products[0], salePriceHT: 12.5, salePriceTTC: 15, availableQuantity: 4 };
  unwrap(await hydrateCounterPosSnapshot(scope, repriced, { now: new Date(T0.getTime() + 60_000) }));
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok, true);
  if (!cached.ok) return;
  const coca = cached.context.products.find((p) => p.id === "p1")!;
  assert.equal(coca.salePriceTTC, 15);
  assert.equal(coca.availableQuantity, 4);
});

// ---------------------------------------------------------------------------
// isolation: organization / user / depot
// ---------------------------------------------------------------------------

test("another organization sees nothing of this snapshot", async () => {
  const orgA = uniqueOrg();
  const orgB = uniqueOrg();
  unwrap(await hydrateCounterPosSnapshot(scopeFor(orgA), makeContext()));
  assert.deepEqual(await loadCachedCounterPosContext(scopeFor(orgB)), { ok: false, reason: "NOT_FOUND" });
});

test("the catalogue is shared by the organization's users, the POS context and stock are per user/depot", async () => {
  const org = uniqueOrg();
  const alice = scopeFor(org, "alice");
  const bob = scopeFor(org, "bob");
  unwrap(await hydrateCounterPosSnapshot(alice, makeContext({ user: { id: "alice", name: "Alice" } }), { now: T0 }));

  // Bob has NOT been mirrored yet: he has no context, even though the catalogue exists.
  assert.deepEqual(await loadCachedCounterPosContext(bob), { ok: false, reason: "NOT_FOUND" });

  const bobContext = makeContext({
    user: { id: "bob", name: "Bob" },
    depot: { id: "depot-2", code: "DEP-02", name: "Depot 2" },
    stockLocation: { id: "loc-2", code: "LOC-2", name: "Depot 2 - stock" },
    bankAccounts: [],
  });
  bobContext.products = bobContext.products.map((p) => ({ ...p, availableQuantity: p.availableQuantity + 1000 }));
  unwrap(await hydrateCounterPosSnapshot(bob, bobContext, { now: T0 }));

  const a = await loadCachedCounterPosContext(alice);
  const b = await loadCachedCounterPosContext(bob);
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.context.user.name, "Alice");
  assert.equal(b.context.user.name, "Bob");
  assert.equal(a.context.stockLocation.id, "loc-1");
  assert.equal(b.context.stockLocation.id, "loc-2");
  assert.equal(a.context.products.find((p) => p.id === "p1")!.availableQuantity, 20, "Alice's depot stock");
  assert.equal(b.context.products.find((p) => p.id === "p1")!.availableQuantity, 1020, "Bob's depot stock");
  assert.deepEqual(a.context.bankAccounts.length, 1);
  assert.deepEqual(b.context.bankAccounts, []);
});

// ---------------------------------------------------------------------------
// stock display = server snapshot - sales the server has not applied yet
// ---------------------------------------------------------------------------

test("applyPendingSalesToContext subtracts and may go negative", () => {
  const adjusted = applyPendingSalesToContext(makeContext(), { p1: 25, p2: 3 });
  assert.equal(adjusted.products.find((p) => p.id === "p1")!.availableQuantity, -5);
  assert.equal(adjusted.products.find((p) => p.id === "p2")!.availableQuantity, -3);
  assert.equal(adjusted.products.find((p) => p.id === "p3")!.availableQuantity, 100, "untouched");
});

test("the displayed stock forgets neither the snapshot NOR the PC's own unsynced sales", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext(), { now: T0 }));

  const { sale } = unwrap(
    await createOfflineSale(scope, makeSaleInput([makeLine("p1", 5)], { idempotencyKey: "s1" }), { now: T0 }),
  );
  const stockOf = async (options?: { applyPendingSales?: boolean }) => {
    const cached = await loadCachedCounterPosContext(scope, options);
    assert.equal(cached.ok, true);
    return cached.ok ? cached.context.products.find((p) => p.id === "p1")!.availableQuantity : NaN;
  };

  assert.equal(await stockOf(), 15, "20 (server) - 5 (pending)");
  assert.equal(await stockOf({ applyPendingSales: false }), 20, "raw server value on request");

  // A refresh that still carries the OLD server value (sale not synced yet)
  // must not bring the 5 units back - the driver layer's bug.
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext(), { now: new Date(T0.getTime() + 1000) }));
  assert.equal(await stockOf(), 15);

  // While SYNCING it is still counted...
  unwrap(await claimSaleForSync(scope, sale.localId));
  assert.equal(await stockOf(), 15);
  // ...once the server applied it, the refreshed server value already includes
  // it and the sale is SYNCED, so it is not subtracted a second time.
  unwrap(await markSaleSynced(scope, sale.localId, { serverSaleId: "srv", officialDisplayNumber: "1/2026" }));
  const refreshed = makeContext();
  refreshed.products[0] = { ...refreshed.products[0], availableQuantity: 15 };
  unwrap(await hydrateCounterPosSnapshot(scope, refreshed, { now: new Date(T0.getTime() + 2000) }));
  assert.equal(await stockOf(), 15, "15, not 10");
});

test("a FAILED (refused) sale does not lower the displayed stock", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext()));
  const { sale } = unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 5)], { idempotencyKey: "f1" })));
  unwrap(await claimSaleForSync(scope, sale.localId));
  unwrap(await markSaleSyncFailure(scope, sale.localId, { code: "CUSTOMER_INACTIVE", message: "x", retryable: false }));
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok && cached.context.products.find((p) => p.id === "p1")!.availableQuantity, 20);
});

// ---------------------------------------------------------------------------
// server first, cache as fallback
// ---------------------------------------------------------------------------

test("ONLINE: uses the server context, mirrors it locally, applies pending sales", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext()));
  unwrap(await createOfflineSale(scope, makeSaleInput([makeLine("p1", 5)], { idempotencyKey: "o1" })));

  let fetched = 0;
  const server = makeContext();
  server.products[0] = { ...server.products[0], salePriceTTC: 13, availableQuantity: 30 };
  const result = await loadCounterPosContext(scope, {
    getNetworkState: async () => "ONLINE",
    fetchContext: async () => {
      fetched += 1;
      return server;
    },
    now: () => T0,
  });

  assert.equal(fetched, 1);
  assert.equal(result.ok && result.source, "server");
  assert.equal(result.ok && result.source === "server" && result.cached, true);
  if (!result.ok) return;
  const coca = result.context.products.find((p) => p.id === "p1")!;
  assert.equal(coca.salePriceTTC, 13);
  assert.equal(coca.availableQuantity, 25, "30 (server) - 5 (this PC's unsynced sale)");

  // ...and the mirror now holds the new price for the next offline start.
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok && cached.context.products.find((p) => p.id === "p1")!.salePriceTTC, 13);
});

test("OFFLINE and SERVER_UNREACHABLE: never calls the server, serves the cache and says why", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext(), { now: T0 }));

  for (const [state, issue] of [
    ["OFFLINE", "OFFLINE"],
    ["SERVER_UNREACHABLE", "UNREACHABLE"],
  ] as const) {
    let fetched = 0;
    const result = await loadCounterPosContext(scope, {
      getNetworkState: async () => state,
      fetchContext: async () => {
        fetched += 1;
        return makeContext();
      },
    });
    assert.equal(fetched, 0);
    assert.equal(result.ok, true);
    if (!result.ok || result.source !== "cache") throw new Error("expected the cache");
    assert.equal(result.serverIssue, issue);
    assert.equal(result.cacheSyncedAt, T0.toISOString());
    assert.equal(result.context.products.length, 3);
    assert.deepEqual(result.counts, { products: 3, customers: 2, stockLevels: 3 });
  }
});

test("a server failure while 'online' falls back to the cache (500 vs 401 distinguished)", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext(), { now: T0 }));

  const cases: Array<[Error, string]> = [
    [new CounterPosContextFetchError("boom", 500), "SERVER_ERROR"],
    [new CounterPosContextFetchError("Session expiree", 401), "AUTH_REQUIRED"],
    [new CounterPosContextFetchError("Interdit", 403), "AUTH_REQUIRED"],
    [new TypeError("Failed to fetch"), "SERVER_ERROR"],
  ];
  for (const [error, issue] of cases) {
    const result = await loadCounterPosContext(scope, {
      getNetworkState: async () => "ONLINE",
      fetchContext: async () => {
        throw error;
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok || result.source !== "cache") throw new Error("expected the cache");
    assert.equal(result.serverIssue, issue);
  }
});

test("no snapshot and no server: an honest failure, not an empty POS", async () => {
  const scope = scopeFor(uniqueOrg());
  const offline = await loadCounterPosContext(scope, { getNetworkState: async () => "OFFLINE" });
  assert.deepEqual(offline, { ok: false, reason: "NOT_FOUND", serverIssue: "OFFLINE" });

  const failing = await loadCounterPosContext(scope, {
    getNetworkState: async () => "ONLINE",
    fetchContext: async () => {
      throw new CounterPosContextFetchError("boom", 502);
    },
  });
  assert.deepEqual(failing, { ok: false, reason: "NOT_FOUND", serverIssue: "SERVER_ERROR" });
});

test("a server context that cannot be mirrored is still returned (cached: false)", async () => {
  const scope = scopeFor(uniqueOrg());
  const result = await loadCounterPosContext(scope, {
    getNetworkState: async () => "ONLINE",
    fetchContext: async () => ({ ...makeContext(), stockLocation: undefined }) as unknown as CounterPosContextDto,
  });
  assert.equal(result.ok && result.source === "server" && result.cached, false);
});

test("the cache survives closing and reopening the database (PC restart)", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext(), { now: T0 }));
  closeCounterPosDatabase(org);
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok && cached.context.products.length, 3);
});
