import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getNetworkState,
  isDeviceOnline,
  isServerReachable,
  subscribeToNetworkState,
  type NetworkState,
} from "./network-status";

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status: number) =>
  new Response("<html>portal</html>", { status, headers: { "content-type": "text/html" } });

const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test("device offline -> OFFLINE, without any request", async () => {
  let calls = 0;
  const state = await getNetworkState({
    isOnLine: () => false,
    fetchFn: async () => {
      calls += 1;
      return json(200);
    },
  });
  assert.equal(state, "OFFLINE");
  assert.equal(calls, 0);
  assert.equal(isDeviceOnline({ isOnLine: () => false }), false);
});

test("our server answering JSON (200, 401 or 500) means ONLINE", async () => {
  for (const status of [200, 401, 500]) {
    const state = await getNetworkState({ isOnLine: () => true, fetchFn: async () => json(status, { user: null }) });
    assert.equal(state, "ONLINE", `status ${status}`);
  }
});

test("a captive portal or proxy error page (HTML) is NOT the server", async () => {
  for (const status of [200, 502, 503]) {
    const state = await getNetworkState({ isOnLine: () => true, fetchFn: async () => html(status) });
    assert.equal(state, "SERVER_UNREACHABLE", `status ${status}`);
  }
});

test("a network failure is SERVER_UNREACHABLE", async () => {
  const state = await getNetworkState({
    isOnLine: () => true,
    fetchFn: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.equal(state, "SERVER_UNREACHABLE");
});

test("a request that never answers is cut off by the timeout", async () => {
  const started = Date.now();
  const reachable = await isServerReachable({
    isOnLine: () => true,
    timeoutMs: 30,
    fetchFn: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  assert.equal(reachable, false);
  assert.ok(Date.now() - started < 1000, "returned promptly");
});

test("the probe targets the configured endpoint, uncached", async () => {
  let seen: { url: string; cache?: RequestCache } | null = null;
  await isServerReachable({
    isOnLine: () => true,
    endpoint: "/custom/health",
    fetchFn: async (input, init) => {
      seen = { url: String(input), cache: init?.cache };
      return json(200);
    },
  });
  assert.deepEqual(seen, { url: "/custom/health", cache: "no-store" });
});

test("subscribe: reports the current state, then only CHANGES", async () => {
  const target = new EventTarget();
  let online = true;
  let reachable = true;
  const seen: NetworkState[] = [];
  const stop = subscribeToNetworkState((state) => seen.push(state), {
    target,
    intervalMs: 0,
    deps: { isOnLine: () => online, fetchFn: async () => (reachable ? json(200) : html(200)) },
  });
  await wait();
  assert.deepEqual(seen, ["ONLINE"]);

  target.dispatchEvent(new Event("online")); // nothing changed
  await wait();
  assert.deepEqual(seen, ["ONLINE"]);

  reachable = false;
  target.dispatchEvent(new Event("online"));
  await wait();
  assert.deepEqual(seen, ["ONLINE", "SERVER_UNREACHABLE"]);

  online = false;
  target.dispatchEvent(new Event("offline"));
  assert.deepEqual(seen, ["ONLINE", "SERVER_UNREACHABLE", "OFFLINE"], "offline is reported immediately");

  online = true;
  reachable = true;
  target.dispatchEvent(new Event("online"));
  await wait();
  assert.deepEqual(seen.at(-1), "ONLINE");

  stop();
  reachable = false;
  target.dispatchEvent(new Event("online"));
  target.dispatchEvent(new Event("offline"));
  await wait();
  assert.equal(seen.at(-1), "ONLINE", "no more events after unsubscribe");
});

test("subscribe: a slow probe finishing after 'offline' cannot overwrite it", async () => {
  const target = new EventTarget();
  const control: { release: (() => void) | null } = { release: null };
  const seen: NetworkState[] = [];
  const stop = subscribeToNetworkState((state) => seen.push(state), {
    target,
    intervalMs: 0,
    deps: {
      isOnLine: () => true,
      fetchFn: () =>
        new Promise<Response>((resolve) => {
          control.release = () => resolve(json(200));
        }),
    },
  });
  await wait();
  target.dispatchEvent(new Event("offline")); // arrives while the probe is in flight
  assert.deepEqual(seen, ["OFFLINE"]);
  control.release?.(); // the stale probe now succeeds
  await wait();
  assert.deepEqual(seen, ["OFFLINE"], "the stale ONLINE result was dropped");
  stop();
});

test("subscribe: the periodic re-check picks up a recovery without any event", async () => {
  let reachable = false;
  const seen: NetworkState[] = [];
  const stop = subscribeToNetworkState((state) => seen.push(state), {
    target: null,
    intervalMs: 15,
    deps: { isOnLine: () => true, fetchFn: async () => (reachable ? json(200) : html(200)) },
  });
  await wait(30);
  assert.equal(seen.at(-1), "SERVER_UNREACHABLE");
  reachable = true;
  await wait(60);
  assert.equal(seen.at(-1), "ONLINE");
  stop();
});
