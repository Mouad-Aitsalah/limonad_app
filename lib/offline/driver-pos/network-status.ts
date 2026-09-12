"use client";

/**
 * Minimal network-state abstraction for the driver POS (Phase 1).
 *
 * No retry engine, no polling loop, no listeners - just two cheap checks a
 * caller can await when it actually needs to know. `navigator.onLine` alone
 * is not trusted (it only reflects "has a network interface", not "can
 * actually reach our server" - a phone can be on Wi-Fi with no internet, or
 * behind a captive portal), so `isServerReachable` backs it with a real
 * request to an endpoint the app already polls for other reasons
 * (GET /api/auth/session - see hooks/use-auth.tsx), instead of standing up
 * a dedicated health-check route.
 */

export type NetworkState = "ONLINE" | "OFFLINE" | "SERVER_UNREACHABLE";

const REACHABILITY_ENDPOINT = "/api/auth/session";
const REACHABILITY_TIMEOUT_MS = 4000;

/** Cheap, synchronous, device-level signal only - see this file's own doc comment. */
export function isNetworkAvailable(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Confirms the app's own server actually answers, not just "some network
 * exists". Any response (even 401/500) counts as reachable - only a network
 * failure or timeout means it doesn't.
 */
export async function isServerReachable(
  timeoutMs: number = REACHABILITY_TIMEOUT_MS,
): Promise<boolean> {
  if (!isNetworkAvailable()) return false;
  if (typeof fetch === "undefined") return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(REACHABILITY_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getNetworkState(): Promise<NetworkState> {
  if (!isNetworkAvailable()) return "OFFLINE";
  return (await isServerReachable()) ? "ONLINE" : "SERVER_UNREACHABLE";
}
