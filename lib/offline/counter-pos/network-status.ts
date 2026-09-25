"use client";

/**
 * COUNTER POS - network state.
 *
 * Same three-state idea as the driver layer's network-status.ts (which is
 * neither modified nor imported here): `navigator.onLine` alone only says a
 * network interface exists, so "reachable" is confirmed with a real request
 * to an endpoint the app already calls (GET /api/auth/session).
 *
 * Two deliberate differences:
 *  - every dependency (online flag, fetch, timeout, endpoint) is injectable,
 *    so the logic is unit-testable and never touches globals in tests;
 *  - a response only counts as "the server answered" when it is JSON. A
 *    captive portal or a proxy error page answers 200/502 with HTML, which
 *    must not make the POS believe it is online. Our own API always answers
 *    JSON, including 401/500.
 */

export type NetworkState = "ONLINE" | "OFFLINE" | "SERVER_UNREACHABLE";

export const REACHABILITY_ENDPOINT = "/api/auth/session";
export const REACHABILITY_TIMEOUT_MS = 4000;

export type NetworkDeps = {
  /** Device-level signal. Defaults to navigator.onLine (true when unknown). */
  isOnLine?: () => boolean;
  fetchFn?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
};

function defaultIsOnLine(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function isDeviceOnline(deps: NetworkDeps = {}): boolean {
  return (deps.isOnLine ?? defaultIsOnLine)();
}

/** True only if OUR server answered with JSON within the timeout. Never throws. */
export async function isServerReachable(deps: NetworkDeps = {}): Promise<boolean> {
  if (!isDeviceOnline(deps)) return false;
  const fetchFn = deps.fetchFn ?? (typeof fetch === "undefined" ? undefined : fetch);
  if (!fetchFn) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? REACHABILITY_TIMEOUT_MS);
  try {
    const response = await fetchFn(deps.endpoint ?? REACHABILITY_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = response.headers?.get("content-type") ?? "";
    return response.status > 0 && contentType.toLowerCase().includes("json");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getNetworkState(deps: NetworkDeps = {}): Promise<NetworkState> {
  if (!isDeviceOnline(deps)) return "OFFLINE";
  return (await isServerReachable(deps)) ? "ONLINE" : "SERVER_UNREACHABLE";
}

type EventTargetLike = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export type NetworkSubscriptionOptions = {
  deps?: NetworkDeps;
  /** Re-check period. Defaults to 30 s (the driver hook's period). 0 disables. */
  intervalMs?: number;
  /** Where online/offline events come from. Defaults to window (if any). */
  target?: EventTargetLike | null;
};

/**
 * Calls `listener` with the current state right away and again ONLY when it
 * changes (browser online/offline events plus a periodic re-check). Returns
 * an unsubscribe function. No retry engine - it only reports.
 */
export function subscribeToNetworkState(
  listener: (state: NetworkState) => void,
  options: NetworkSubscriptionOptions = {},
): () => void {
  const { deps = {}, intervalMs = 30_000 } = options;
  const target =
    options.target === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : options.target;

  let active = true;
  let last: NetworkState | null = null;
  let generation = 0;

  async function check() {
    const mine = ++generation;
    const next = await getNetworkState(deps);
    // A newer check started meanwhile, or we were unsubscribed: drop this one.
    if (!active || mine !== generation) return;
    if (next !== last) {
      last = next;
      listener(next);
    }
  }

  const onOnline = () => void check();
  const onOffline = () => {
    generation += 1;
    if (last !== "OFFLINE") {
      last = "OFFLINE";
      listener("OFFLINE");
    }
  };

  target?.addEventListener("online", onOnline);
  target?.addEventListener("offline", onOffline);
  const timer = intervalMs > 0 ? setInterval(() => void check(), intervalMs) : null;
  void check();

  return () => {
    active = false;
    target?.removeEventListener("online", onOnline);
    target?.removeEventListener("offline", onOffline);
    if (timer) clearInterval(timer);
  };
}
