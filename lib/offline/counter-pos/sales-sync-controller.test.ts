import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import { closeCounterPosDatabase } from "./database";
import { countOfflineSalesByStatus, createOfflineSale, getOfflineSale } from "./sales-store";
import { startCounterSalesAutoSync, type SalesSyncStatus } from "./sales-sync-controller";
import type { SyncSalesDeps, SyncSalesResult } from "./sales-sync";
import type { NetworkState } from "./network-status";
import type { CounterPosScope } from "./schema";
import { makeLine, makeSaleInput, uniqueOrg, unwrap } from "./test-helpers";

const T0 = new Date("2026-09-25T10:00:00.000Z");
const HOUR = 3_600_000;

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls instead of sleeping a fixed time: a loaded machine must not fail a correct run. */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await tick(5);
  }
  throw new Error("waitFor: condition not met in time");
}

function emitter() {
  const listeners = new Set<(state: NetworkState) => void>();
  return {
    subscribe: (listener: (state: NetworkState) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit: (state: NetworkState) => listeners.forEach((listener) => listener(state)),
    size: () => listeners.size,
  };
}

function result(partial: Partial<SyncSalesResult> = {}): SyncSalesResult {
  return { status: "DONE", attempted: 1, synced: 1, failed: 0, retryLater: 0, outcomes: [], ...partial };
}

const SCOPE: CounterPosScope = { organizationId: "org-ctl", userId: "user-1" };

// ---------------------------------------------------------------------------
// When it fires (fake engine)
// ---------------------------------------------------------------------------

test("OFFLINE -> ONLINE triggers one sync and nothing runs while offline", async () => {
  const net = emitter();
  const triggers: string[] = [];
  const controller = startCounterSalesAutoSync(SCOPE, {
    subscribe: net.subscribe,
    intervalMs: 0,
    sync: async () => result(),
    onStatus: (status) => {
      if (!status.running && status.lastRun) triggers.push(status.lastRun.trigger);
    },
  });

  net.emit("OFFLINE");
  await tick();
  assert.deepEqual(triggers, []); // nothing while offline

  net.emit("ONLINE");
  await tick();
  assert.deepEqual(triggers, ["RECONNECT"]);
  controller.stop();
});

test("the reconnection is labelled RECONNECT when the app had already seen a state", async () => {
  const net = emitter();
  const runs: string[] = [];
  const controller = startCounterSalesAutoSync(SCOPE, {
    subscribe: (listener) => {
      const stop = net.subscribe(listener);
      listener("OFFLINE"); // the state known at start
      return stop;
    },
    intervalMs: 0,
    sync: async () => result(),
    onStatus: (status) => {
      if (!status.running && status.lastRun) runs.push(status.lastRun.trigger);
    },
  });
  net.emit("ONLINE");
  await tick();
  net.emit("ONLINE"); // no transition
  await tick();
  net.emit("SERVER_UNREACHABLE");
  await tick();
  net.emit("ONLINE"); // server is back
  await tick();
  assert.deepEqual(runs, ["RECONNECT", "RECONNECT"]);
  controller.stop();
});

test("already ONLINE at start: one STARTUP run (pending sales of a previous session are sent)", async () => {
  const net = emitter();
  let calls = 0;
  const controller = startCounterSalesAutoSync(SCOPE, {
    subscribe: (listener) => {
      const stop = net.subscribe(listener);
      listener("ONLINE");
      return stop;
    },
    intervalMs: 0,
    sync: async () => {
      calls += 1;
      return result();
    },
  });
  await tick();
  assert.equal(calls, 1);
  assert.equal(controller.getStatus().lastRun?.trigger, "STARTUP");
  controller.stop();
});

test("the interval only fires while ONLINE", async () => {
  const net = emitter();
  let calls = 0;
  const controller = startCounterSalesAutoSync(SCOPE, {
    subscribe: net.subscribe,
    intervalMs: 15,
    sync: async () => {
      calls += 1;
      return result({ status: "NOTHING_TO_SYNC", attempted: 0, synced: 0 });
    },
  });
  net.emit("OFFLINE");
  await tick(60);
  assert.equal(calls, 0);
  net.emit("ONLINE");
  await tick(5);
  const afterReconnect = calls;
  await tick(60);
  assert.ok(calls > afterReconnect, "periodic retries happen while online");
  controller.stop();
  const stoppedAt = calls;
  await tick(50);
  assert.equal(calls, stoppedAt);
  assert.equal(net.size(), 0);
});

test("'Synchroniser maintenant' works while OFFLINE and skips the backoff", async () => {
  const net = emitter();
  const seen: Array<SyncSalesDeps | undefined> = [];
  const controller = startCounterSalesAutoSync(SCOPE, {
    subscribe: net.subscribe,
    intervalMs: 0,
    sync: async (_scope, deps) => {
      seen.push(deps);
      return result();
    },
  });
  net.emit("OFFLINE");
  const outcome = await controller.syncNow();
  assert.equal(outcome.synced, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.ignoreBackoff, true);
  assert.equal(controller.getStatus().lastRun?.trigger, "MANUAL");
  controller.stop();
});

test("never two syncs at once: reconnect + manual clicks + interval share ONE run", async () => {
  const net = emitter();
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const controller = startCounterSalesAutoSync(SCOPE, {
    subscribe: net.subscribe,
    intervalMs: 5,
    sync: async () => {
      calls += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await tick(60);
      concurrent -= 1;
      return result();
    },
  });
  net.emit("ONLINE");
  const [a, b, c] = await Promise.all([controller.syncNow(), controller.syncNow(), controller.syncNow()]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(maxConcurrent, 1);
  assert.equal(calls, 1);
  controller.stop();
});

test("status: running while it works, then the summary; an empty run keeps the last useful summary", async () => {
  const net = emitter();
  const statuses: SalesSyncStatus[] = [];
  let next = result({ synced: 3, attempted: 3 });
  const controller = startCounterSalesAutoSync(SCOPE, {
    subscribe: net.subscribe,
    intervalMs: 0,
    sync: async () => {
      await tick(10);
      return next;
    },
    onStatus: (status) => statuses.push(status),
  });
  await controller.syncNow();
  assert.deepEqual(statuses.map((s) => s.running), [true, false]);
  assert.equal(controller.getStatus().lastRun?.result.synced, 3);

  next = result({ status: "NOTHING_TO_SYNC", attempted: 0, synced: 0 });
  await controller.syncNow();
  assert.equal(controller.getStatus().lastRun?.result.synced, 3, "'3 ventes synchronisées' is not erased by an empty run");
  controller.stop();
});

test("an engine crash is contained: the controller stays usable", async () => {
  const net = emitter();
  let calls = 0;
  const controller = startCounterSalesAutoSync(SCOPE, {
    subscribe: net.subscribe,
    intervalMs: 0,
    sync: async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return result();
    },
  });
  assert.equal((await controller.syncNow()).status, "STOPPED_SERVER");
  assert.equal((await controller.syncNow()).synced, 1);
  controller.stop();
});

// ---------------------------------------------------------------------------
// End to end with the real engine and IndexedDB
// ---------------------------------------------------------------------------

/** A server confirming each idempotencyKey once, with switchable failures. */
function server() {
  const sales = new Map<string, string>();
  const state = { down: false, failNextCalls: 0, rejectKey: null as string | null, calls: 0 };
  const fetchFn: typeof fetch = async (_input, init) => {
    state.calls += 1;
    const body = JSON.parse(String(init?.body)) as { idempotencyKey: string; localId: string; totals: { totalTTC: number } };
    if (state.down) return new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    if (state.failNextCalls > 0) {
      state.failNextCalls -= 1;
      throw new TypeError("Failed to fetch");
    }
    if (body.idempotencyKey === state.rejectKey) {
      return json(409, { success: false, code: "CUSTOMER_INACTIVE", message: "Client inactif ou bloque.", retryable: false });
    }
    const known = sales.has(body.idempotencyKey);
    if (!known) sales.set(body.idempotencyKey, `srv-${sales.size + 1}`);
    return json(200, {
      success: true,
      result: known ? "ALREADY_SYNCED" : "CREATED",
      localId: body.localId,
      serverSaleId: sales.get(body.idempotencyKey),
      officialDisplayNumber: `${sales.size}/2026`,
      serverTotalTTC: body.totals.totalTTC,
      totalMismatch: false,
    });
  };
  return { sales, state, fetchFn };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function seed(count: number) {
  const scope: CounterPosScope = { organizationId: uniqueOrg("ctl"), userId: "user-1" };
  const ids: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const { sale } = unwrap(
      await createOfflineSale(scope, makeSaleInput([makeLine("p1", i)], { idempotencyKey: `key-${i}` }), {
        now: new Date(T0.getTime() + i * 1000),
      }),
    );
    ids.push(sale.localId);
  }
  return { scope, ids };
}

const noLock = async <T>(_name: string, fn: () => Promise<T>) => fn();

test("network cut, sales kept, network back: 3 PENDING sales are sent automatically and become SYNCED", async () => {
  const { scope, ids } = await seed(3);
  const net = emitter();
  const srv = server();
  const controller = startCounterSalesAutoSync(scope, {
    subscribe: net.subscribe,
    intervalMs: 0,
    syncDeps: { fetchFn: srv.fetchFn, now: () => new Date(T0.getTime() + HOUR), withLock: noLock },
  });

  net.emit("OFFLINE");
  await tick(20);
  assert.equal(srv.state.calls, 0); // nothing leaves while offline
  assert.equal(unwrap(await countOfflineSalesByStatus(scope)).PENDING, 3);

  net.emit("ONLINE");
  await waitFor(() => controller.getStatus().lastRun !== null && !controller.getStatus().running);
  assert.equal(unwrap(await countOfflineSalesByStatus(scope)).SYNCED, 3);
  assert.equal(controller.getStatus().lastRun?.result.synced, 3);
  assert.equal(srv.sales.size, 3);
  for (const id of ids) assert.equal(unwrap(await getOfflineSale(scope, id)).status, "SYNCED");
  controller.stop();
});

test("close the app, reopen: the PENDING sales are still there and are sent at start-up", async () => {
  const { scope } = await seed(2);
  // First session: offline the whole time, then the window is closed.
  const net1 = emitter();
  const first = startCounterSalesAutoSync(scope, {
    subscribe: net1.subscribe,
    intervalMs: 0,
    syncDeps: { fetchFn: server().fetchFn, withLock: noLock },
  });
  net1.emit("OFFLINE");
  await tick(10);
  first.stop();
  closeCounterPosDatabase(scope.organizationId);

  // Second session, connection is back at start-up.
  const srv = server();
  const second = startCounterSalesAutoSync(scope, {
    subscribe: (listener) => {
      listener("ONLINE");
      return () => undefined;
    },
    intervalMs: 0,
    syncDeps: { fetchFn: srv.fetchFn, now: () => new Date(T0.getTime() + HOUR), withLock: noLock },
  });
  await waitFor(() => second.getStatus().lastRun !== null && !second.getStatus().running);
  assert.equal(second.getStatus().lastRun?.trigger, "STARTUP");
  assert.equal(unwrap(await countOfflineSalesByStatus(scope)).SYNCED, 2);
  assert.equal(srv.sales.size, 2);
  second.stop();
});

test("Internet back but server down: nothing lost, then a later automatic retry succeeds (second attempt)", async () => {
  const { scope, ids } = await seed(2);
  const net = emitter();
  const srv = server();
  srv.state.down = true;
  let now = new Date(T0.getTime() + HOUR);
  const controller = startCounterSalesAutoSync(scope, {
    subscribe: net.subscribe,
    intervalMs: 15,
    syncDeps: { fetchFn: srv.fetchFn, now: () => now, withLock: noLock },
  });

  net.emit("ONLINE");
  await waitFor(() => controller.getStatus().lastRun?.result.status === "STOPPED_SERVER");
  let counts = unwrap(await countOfflineSalesByStatus(scope));
  assert.equal(counts.PENDING, 2);
  assert.equal(counts.SYNCED + counts.FAILED, 0);
  const afterFirst = unwrap(await getOfflineSale(scope, ids[0]));
  assert.equal(afterFirst.lastError?.retryable, true);
  assert.equal(afterFirst.syncAttempts, 1);
  assert.ok(srv.state.calls >= 1);
  assert.equal(controller.getStatus().lastRun?.result.status, "STOPPED_SERVER");

  // Still inside the backoff window: the periodic check does not re-send a sale
  // that is waiting for its retry time (a sale never attempted yet may go).
  await tick(60);
  assert.equal(unwrap(await getOfflineSale(scope, ids[0])).syncAttempts, 1);

  // Server back + backoff elapsed: the automatic retry succeeds.
  srv.state.down = false;
  now = new Date(T0.getTime() + 3 * HOUR);
  await waitFor(async () => unwrap(await countOfflineSalesByStatus(scope)).SYNCED === 2);
  counts = unwrap(await countOfflineSalesByStatus(scope));
  assert.equal(counts.SYNCED, 2);
  assert.equal(unwrap(await getOfflineSale(scope, ids[0])).syncAttempts, 2);
  controller.stop();
});

test("error during synchronisation: the failed sale stays PENDING, the manual button retries it now", async () => {
  const { scope, ids } = await seed(3);
  const net = emitter();
  const srv = server();
  srv.state.failNextCalls = 2; // the first two requests die on the network
  const controller = startCounterSalesAutoSync(scope, {
    subscribe: net.subscribe,
    intervalMs: 0,
    syncDeps: { fetchFn: srv.fetchFn, now: () => new Date(T0.getTime() + HOUR), withLock: noLock },
  });

  net.emit("ONLINE");
  await waitFor(() => controller.getStatus().lastRun !== null && !controller.getStatus().running);
  assert.equal(controller.getStatus().lastRun?.result.status, "STOPPED_NETWORK");
  let counts = unwrap(await countOfflineSalesByStatus(scope));
  assert.equal(counts.SYNCED, 0);
  assert.equal(counts.PENDING, 3);

  // Its backoff has not elapsed (same instant): the button skips the wait.
  const secondFailure = await controller.syncNow(); // the last injected network failure
  assert.equal(secondFailure.status, "STOPPED_NETWORK");
  assert.equal(secondFailure.synced, 0);
  assert.equal(unwrap(await getOfflineSale(scope, ids[0])).syncAttempts, 2);
  const recovered = await controller.syncNow(); // second attempt onward: everything goes
  assert.equal(recovered.synced, 3);
  counts = unwrap(await countOfflineSalesByStatus(scope));
  assert.equal(counts.SYNCED, 3);
  assert.equal(srv.sales.size, 3);
  for (const id of ids) assert.equal(unwrap(await getOfflineSale(scope, id)).status, "SYNCED");
  controller.stop();
});

test("a rejected sale is counted as an error and does not block the others", async () => {
  const { scope, ids } = await seed(3);
  const srv = server();
  srv.state.rejectKey = "key-2";
  const controller = startCounterSalesAutoSync(scope, {
    subscribe: (listener) => {
      listener("ONLINE");
      return () => undefined;
    },
    intervalMs: 0,
    syncDeps: { fetchFn: srv.fetchFn, now: () => new Date(T0.getTime() + HOUR), withLock: noLock },
  });
  await waitFor(() => controller.getStatus().lastRun !== null && !controller.getStatus().running);
  const run = controller.getStatus().lastRun?.result;
  assert.equal(run?.synced, 2);
  assert.equal(run?.failed, 1);
  const counts = unwrap(await countOfflineSalesByStatus(scope));
  assert.deepEqual([counts.SYNCED, counts.FAILED, counts.PENDING], [2, 1, 0]);
  assert.equal(unwrap(await getOfflineSale(scope, ids[1])).lastError?.message, "Client inactif ou bloque.");
  controller.stop();
});
