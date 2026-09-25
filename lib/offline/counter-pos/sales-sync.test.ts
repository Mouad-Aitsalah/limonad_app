import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCounterSaleInput,
  counterSaleSyncSchema,
  type CounterSaleSyncPayload,
} from "@/lib/counter-sale-sync-contract";

import { closeCounterPosDatabase } from "./database";
import { buildCounterSyncPayload, isCounterSalesSyncRunning, syncOfflineCounterSales } from "./sales-sync";
import {
  claimSaleForSync,
  countOfflineSalesByStatus,
  createOfflineSale,
  getOfflineSale,
  SYNC_MAX_ATTEMPTS,
} from "./sales-store";
import type { CounterPosScope } from "./schema";
import { makeLine, makeSaleInput, uniqueOrg, unwrap } from "./test-helpers";

const T0 = new Date("2026-09-25T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 3_600_000;

type Behavior =
  | { kind: "network" }
  | { kind: "status"; status: number; body?: unknown; contentType?: string }
  | { kind: "created-then-network" }; // the server commits, the answer is lost

/** A stand-in for POST /api/sales/sync with the real contract + idempotency. */
class FakeSyncServer {
  sales = new Map<string, { id: string; number: string; payload: CounterSaleSyncPayload }>();
  requests: CounterSaleSyncPayload[] = [];
  inFlight = 0;
  maxInFlight = 0;
  behaviors: Behavior[] = [];
  /** Made-up per-key overrides, e.g. a business rejection for one sale. */
  rejectKeys = new Map<string, { status: number; code: string; message: string; retryable: boolean }>();
  delayMs = 0;
  private seq = 0;

  fetch: typeof fetch = async (_input, init) => {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      const parsed = counterSaleSyncSchema.safeParse(JSON.parse(String(init?.body)));
      if (!parsed.success) return respond(422, { success: false, code: "VALIDATION_ERROR", message: "invalide", retryable: false });
      const payload = parsed.data;
      this.requests.push(payload);

      const behavior = this.behaviors.shift();
      if (behavior?.kind === "network") throw new TypeError("Failed to fetch");
      if (behavior?.kind === "status") {
        const raw = typeof behavior.body === "string" ? behavior.body : JSON.stringify(behavior.body ?? {});
        return new Response(raw, {
          status: behavior.status,
          headers: { "content-type": behavior.contentType ?? "application/json" },
        });
      }
      const rejection = this.rejectKeys.get(payload.idempotencyKey);
      if (rejection) {
        return respond(rejection.status, { success: false, code: rejection.code, message: rejection.message, retryable: rejection.retryable });
      }

      const known = this.sales.get(payload.idempotencyKey);
      const sale = known ?? { id: `srv-${++this.seq}`, number: `${this.seq}/2026`, payload };
      if (!known) this.sales.set(payload.idempotencyKey, sale);
      if (behavior?.kind === "created-then-network") throw new TypeError("Failed to fetch");
      return respond(200, {
        success: true,
        result: known ? "ALREADY_SYNCED" : "CREATED",
        localId: payload.localId,
        serverSaleId: sale.id,
        officialDisplayNumber: sale.number,
        serverTotalTTC: payload.totals.totalTTC,
        totalMismatch: false,
      });
    } finally {
      this.inFlight -= 1;
    }
  };
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function seed(count: number, options: { org?: string } = {}) {
  const org = options.org ?? uniqueOrg();
  const scope: CounterPosScope = { organizationId: org, userId: "user-1" };
  const ids: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const { sale } = unwrap(
      await createOfflineSale(scope, makeSaleInput([makeLine("p1", i)], { idempotencyKey: `key-${i}` }), { now: at(i * 1000) }),
    );
    ids.push(sale.localId);
  }
  return { org, scope, ids };
}

const noLock = async <T>(_name: string, fn: () => Promise<T>) => fn();

async function statusOf(scope: CounterPosScope, id: string) {
  return unwrap(await getOfflineSale(scope, id));
}

// ---------------------------------------------------------------------------

test("payload: rebuilds exactly the CounterSaleInput of the online POS", async () => {
  const { scope, ids } = await seed(1);
  const sale = await statusOf(scope, ids[0]);
  const payload = buildCounterSyncPayload({ ...sale, reservedSaleNumber: 41, reservedSaleYear: 2026 });
  const parsed = counterSaleSyncSchema.parse(JSON.parse(JSON.stringify(payload)));
  const input = buildCounterSaleInput(parsed) as unknown as Record<string, unknown>;
  assert.equal(input.paymentMethod, "CASH");
  assert.equal(input.customerId, "cust-1");
  assert.equal(input.idempotencyKey, "key-1");
  assert.equal(input.reservedSaleNumber, 41);
  assert.equal(input.reservedSaleYear, 2026);
  assert.deepEqual(input.lines, [{ productId: "p1", quantity: 1, discountUnitAmount: 0 }]);
  assert.equal("paidAmount" in input, false);
});

test("payload: MIXED becomes cashAmount/chequeAmount, manual price and bank account are carried", () => {
  const base: CounterSaleSyncPayload = {
    localId: "l1", idempotencyKey: "k", organizationId: "o", userId: "u", customerId: "c",
    paymentMethod: "MIXED", reference: null, bankAccountingAccountId: null,
    payments: [{ method: "CASH", amount: 20 }, { method: "CHECK", amount: 16, reference: "77" }],
    totals: { totalTTC: 36, paidAmount: 36, creditAmount: 0 },
    lines: [{ productId: "p1", quantity: 2, discountUnitAmount: 0.5, unitPriceHT: 4 }],
  };
  const mixed = buildCounterSaleInput(base) as unknown as Record<string, unknown>;
  assert.equal(mixed.cashAmount, 20);
  assert.equal(mixed.chequeAmount, 16);
  assert.deepEqual(mixed.lines, [{ productId: "p1", quantity: 2, discountUnitAmount: 0.5, unitPriceHT: 4 }]);
  const bank = buildCounterSaleInput({ ...base, paymentMethod: "BANK_TRANSFER", bankAccountingAccountId: "bank-1", payments: [{ method: "BANK_TRANSFER", amount: 36 }] }) as unknown as Record<string, unknown>;
  assert.equal(bank.bankAccountingAccountId, "bank-1");
  // CREDIT is not part of the offline contract at all.
  assert.equal(counterSaleSyncSchema.safeParse({ ...base, paymentMethod: "CREDIT" }).success, false);
});

test("1 sale: PENDING -> SYNCED only after the server confirms, with server id and official number", async () => {
  const { scope, ids } = await seed(1);
  const server = new FakeSyncServer();
  const result = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });

  assert.equal(result.status, "DONE");
  assert.equal(result.synced, 1);
  const sale = await statusOf(scope, ids[0]);
  assert.equal(sale.status, "SYNCED");
  assert.equal(sale.serverSaleId, "srv-1");
  assert.equal(sale.officialDisplayNumber, "1/2026");
  assert.equal(sale.syncedAt, at(HOUR).toISOString());
  assert.equal(server.requests[0].idempotencyKey, "key-1");
  assert.equal(server.requests[0].organizationId, scope.organizationId);
  assert.equal(server.requests[0].lines.length, 1);
});

test("10 sales: all synchronised one by one, oldest first, never in parallel", async () => {
  const { scope, ids } = await seed(10);
  const server = new FakeSyncServer();
  server.delayMs = 2;
  const result = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });

  assert.equal(result.synced, 10);
  assert.equal(server.maxInFlight, 1);
  assert.deepEqual(server.requests.map((r) => r.idempotencyKey), Array.from({ length: 10 }, (_, i) => `key-${i + 1}`));
  assert.equal(server.sales.size, 10);
  const counts = unwrap(await countOfflineSalesByStatus(scope));
  assert.deepEqual(counts, { PENDING: 0, SYNCING: 0, SYNCED: 10, FAILED: 0 });
  for (const id of ids) assert.equal((await statusOf(scope, id)).status, "SYNCED");
});

test("double synchronisation: two simultaneous runs send each sale once; a later run has nothing to do", async () => {
  const { scope } = await seed(3);
  const server = new FakeSyncServer();
  server.delayMs = 5;
  const deps = { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock };
  const [a, b] = await Promise.all([syncOfflineCounterSales(scope, deps), syncOfflineCounterSales(scope, deps)]);

  assert.deepEqual([a.status, b.status].sort(), ["ALREADY_RUNNING", "DONE"]);
  assert.equal(server.requests.length, 3);
  assert.equal(server.sales.size, 3);
  assert.equal(isCounterSalesSyncRunning(scope), false);
  assert.equal((await syncOfflineCounterSales(scope, deps)).status, "NOTHING_TO_SYNC");
  assert.equal(server.requests.length, 3);
});

test("another tab holding the lock: the run does nothing", async () => {
  const { scope, ids } = await seed(1);
  const server = new FakeSyncServer();
  const result = await syncOfflineCounterSales(scope, {
    fetchFn: server.fetch,
    withLock: async () => undefined,
  });
  assert.equal(result.status, "ALREADY_RUNNING");
  assert.equal(server.requests.length, 0);
  assert.equal((await statusOf(scope, ids[0])).status, "PENDING");
});

test("network cut during the sync: earlier sales stay SYNCED, the cut one goes back to PENDING (retryable), the rest is untouched", async () => {
  const { scope, ids } = await seed(3);
  const server = new FakeSyncServer();
  server.behaviors = [{ kind: "status", status: 200, body: undefined }, { kind: "network" }];
  // first request: fall through to normal handling
  server.behaviors = [];
  let calls = 0;
  const flaky: typeof fetch = (input, init) => {
    calls += 1;
    if (calls === 2) return Promise.reject(new TypeError("Failed to fetch"));
    return server.fetch(input, init);
  };
  const result = await syncOfflineCounterSales(scope, { fetchFn: flaky, now: () => at(HOUR), withLock: noLock });

  assert.equal(result.status, "STOPPED_NETWORK");
  assert.equal((await statusOf(scope, ids[0])).status, "SYNCED");
  const second = await statusOf(scope, ids[1]);
  assert.equal(second.status, "PENDING");
  assert.equal(second.lastError?.code, "NETWORK_ERROR");
  assert.equal(second.syncAttempts, 1);
  assert.ok(second.nextAttemptAt && second.nextAttemptAt > at(HOUR).toISOString());
  assert.equal((await statusOf(scope, ids[2])).syncAttempts, 0); // never attempted
  assert.equal(calls, 2); // the run stopped, it did not hammer sale 3

  // Not retried before its backoff...
  const early = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR + 1000), withLock: noLock });
  assert.equal(early.synced, 1); // sale 3 (no backoff) goes, sale 2 waits
  assert.equal((await statusOf(scope, ids[1])).status, "PENDING");
  // ...and goes through once it elapsed.
  const later = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(2 * HOUR), withLock: noLock });
  assert.equal(later.synced, 1);
  assert.equal((await statusOf(scope, ids[1])).status, "SYNCED");
  assert.equal(server.sales.size, 3);
});

test("the answer is lost after the server committed: the retry is a duplicate and ends SYNCED with ONE server sale", async () => {
  const { scope, ids } = await seed(1);
  const server = new FakeSyncServer();
  server.behaviors = [{ kind: "created-then-network" }];
  const first = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });
  assert.equal(first.status, "STOPPED_NETWORK");
  assert.equal((await statusOf(scope, ids[0])).status, "PENDING"); // NOT synced: no confirmation received
  assert.equal(server.sales.size, 1);

  const second = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(3 * HOUR), withLock: noLock });
  assert.equal(second.synced, 1);
  const outcome = second.outcomes[0];
  assert.equal(outcome.outcome === "SYNCED" && outcome.duplicate, true);
  const sale = await statusOf(scope, ids[0]);
  assert.equal(sale.status, "SYNCED");
  assert.equal(sale.serverSaleId, "srv-1");
  assert.equal(server.sales.size, 1);
});

test("server unavailable (503 / HTML 502): PENDING + retryable, backoff grows, and the budget ends in FAILED", async () => {
  const { scope, ids } = await seed(2);
  const server = new FakeSyncServer();
  server.behaviors = [{ kind: "status", status: 503, body: { success: false, code: "SALE_SYNC_FAILED", message: "Indisponible", retryable: true } }];
  const first = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });
  assert.equal(first.status, "STOPPED_SERVER");
  assert.equal(server.requests.length, 1); // the second sale was not sent
  let sale = await statusOf(scope, ids[0]);
  assert.equal(sale.status, "PENDING");
  assert.equal(sale.lastError?.code, "SALE_SYNC_FAILED");
  assert.equal(sale.lastError?.retryable, true);
  assert.equal(sale.lastError?.httpStatus, 503);

  // An HTML error page from a proxy is not a confirmation either.
  server.behaviors = [{ kind: "status", status: 502, body: "<html>Bad gateway</html>", contentType: "text/html" }];
  await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(2 * HOUR), withLock: noLock });
  sale = await statusOf(scope, ids[0]);
  assert.equal(sale.status, "PENDING");
  assert.equal(sale.syncAttempts, 2);

  // Down forever: it does not loop, it ends FAILED after the budget.
  server.behaviors = Array.from({ length: 20 }, () => ({ kind: "status" as const, status: 503, body: {} }));
  for (let i = 0; i < SYNC_MAX_ATTEMPTS + 2; i += 1) {
    await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at((10 + i * 2) * HOUR), withLock: noLock, ignoreBackoff: true });
  }
  sale = await statusOf(scope, ids[0]);
  assert.equal(sale.status, "FAILED");
  assert.equal(sale.syncAttempts, SYNC_MAX_ATTEMPTS);
});

test("duplicate idempotencyKey already on the server: considered synchronised, no second sale", async () => {
  const { scope, ids } = await seed(1);
  const server = new FakeSyncServer();
  // Another device/attempt already created it.
  const existing = counterSaleSyncSchema.parse(JSON.parse(JSON.stringify(buildCounterSyncPayload(await statusOf(scope, ids[0])))));
  server.sales.set("key-1", { id: "srv-existing", number: "12/2026", payload: existing });

  const result = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });
  assert.equal(result.synced, 1);
  const sale = await statusOf(scope, ids[0]);
  assert.equal(sale.status, "SYNCED");
  assert.equal(sale.serverSaleId, "srv-existing");
  assert.equal(sale.officialDisplayNumber, "12/2026");
  assert.equal(server.sales.size, 1);
});

test("business error: FAILED at once with the precise message, no retry, and the next sales still go", async () => {
  const { scope, ids } = await seed(3);
  const server = new FakeSyncServer();
  server.rejectKeys.set("key-2", { status: 409, code: "CUSTOMER_INACTIVE", message: "Client inactif ou bloque.", retryable: false });
  const result = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });

  assert.equal(result.status, "DONE");
  assert.equal(result.synced, 2);
  assert.equal(result.failed, 1);
  const failed = await statusOf(scope, ids[1]);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.lastError?.code, "CUSTOMER_INACTIVE");
  assert.equal(failed.lastError?.message, "Client inactif ou bloque.");
  assert.equal(failed.lastError?.retryable, false);
  assert.equal(failed.syncAttempts, 1);
  assert.equal((await statusOf(scope, ids[2])).status, "SYNCED");

  // Never picked up again by itself.
  const again = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(9 * HOUR), withLock: noLock });
  assert.equal(again.status, "NOTHING_TO_SYNC");
});

test("authorization: 403 is FAILED without a loop; 401 pauses the run and keeps the sale PENDING without burning an attempt", async () => {
  const forbidden = await seed(1);
  const server = new FakeSyncServer();
  server.behaviors = [{ kind: "status", status: 403, body: { success: false, code: "FORBIDDEN", message: "Acces refuse", retryable: false } }];
  const r1 = await syncOfflineCounterSales(forbidden.scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });
  assert.equal(r1.failed, 1);
  assert.equal((await statusOf(forbidden.scope, forbidden.ids[0])).status, "FAILED");
  assert.equal((await syncOfflineCounterSales(forbidden.scope, { fetchFn: server.fetch, now: () => at(2 * HOUR), withLock: noLock })).status, "NOTHING_TO_SYNC");

  const expired = await seed(2);
  server.behaviors = [{ kind: "status", status: 401, body: { success: false, code: "AUTH_REQUIRED", message: "Session expiree", retryable: true } }];
  const r2 = await syncOfflineCounterSales(expired.scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });
  assert.equal(r2.status, "PAUSED_AUTH");
  const paused = await statusOf(expired.scope, expired.ids[0]);
  assert.equal(paused.status, "PENDING");
  assert.equal(paused.syncAttempts, 0);
  assert.equal(server.requests.filter((r) => r.organizationId === expired.scope.organizationId).length, 1); // stopped, no loop
  // After login the same sales go through.
  const r3 = await syncOfflineCounterSales(expired.scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });
  assert.equal(r3.synced, 2);
});

test("a 200 that is not a real confirmation never makes a sale SYNCED", async () => {
  const { scope, ids } = await seed(1);
  const server = new FakeSyncServer();
  server.behaviors = [{ kind: "status", status: 200, body: { success: true } }];
  const result = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });
  assert.equal(result.synced, 0);
  const sale = await statusOf(scope, ids[0]);
  assert.equal(sale.status, "PENDING");
  assert.equal(sale.lastError?.code, "INVALID_SERVER_RESPONSE");
  assert.equal(sale.serverSaleId, null);
});

test("a request that never answers times out and stays retryable", async () => {
  const { scope, ids } = await seed(1);
  const hang: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const result = await syncOfflineCounterSales(scope, { fetchFn: hang, timeoutMs: 20, now: () => at(HOUR), withLock: noLock });
  assert.equal(result.status, "STOPPED_NETWORK");
  const sale = await statusOf(scope, ids[0]);
  assert.equal(sale.status, "PENDING");
  assert.equal(sale.lastError?.code, "TIMEOUT");
});

test("restart while SYNCING: the interrupted sale is recovered and sent; if the server had it, it is a duplicate", async () => {
  const { scope, ids } = await seed(2, {});
  // Sale 1 was mid-flight when the window closed (and the server did create it).
  unwrap(await claimSaleForSync(scope, ids[0], { now: at(HOUR) }));
  const server = new FakeSyncServer();
  server.sales.set("key-1", {
    id: "srv-lost-answer",
    number: "7/2026",
    payload: counterSaleSyncSchema.parse(JSON.parse(JSON.stringify(buildCounterSyncPayload(await statusOf(scope, ids[0]))))),
  });
  assert.equal((await statusOf(scope, ids[0])).status, "SYNCING");

  // "Reopen the app": the database connection is new, the state is on disk.
  closeCounterPosDatabase(scope.organizationId);
  const result = await syncOfflineCounterSales(scope, { fetchFn: server.fetch, now: () => at(HOUR + 5000), withLock: noLock });

  assert.equal(result.synced, 2);
  const recovered = await statusOf(scope, ids[0]);
  assert.equal(recovered.status, "SYNCED");
  assert.equal(recovered.serverSaleId, "srv-lost-answer");
  assert.equal(server.sales.size, 2); // no duplicate
  assert.equal(unwrap(await countOfflineSalesByStatus(scope)).SYNCING, 0);
});

test("sales of another organization/user are never sent", async () => {
  const mine = await seed(1);
  const theirs = await seed(1);
  const server = new FakeSyncServer();
  await syncOfflineCounterSales(mine.scope, { fetchFn: server.fetch, now: () => at(HOUR), withLock: noLock });
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].organizationId, mine.scope.organizationId);
  assert.equal((await statusOf(theirs.scope, theirs.ids[0])).status, "PENDING");
  const otherUser = { organizationId: mine.org, userId: "user-2" };
  assert.equal((await syncOfflineCounterSales(otherUser, { fetchFn: server.fetch, withLock: noLock })).status, "NOTHING_TO_SYNC");
});
