import {
  getCachedCustomers,
  hydrateDriverOfflineCache,
  loadCachedDriverPosContext,
  saveCachedCustomers,
  syncPendingDriverSales,
  type SyncBatchResult,
} from "@/lib/offline/driver-pos";
import type { CustomerDto, DriverPosContextDto } from "@/types/operations-dto";

import { apiUrl } from "./api-base";
import { mobileFetch } from "./mobile-fetch";

/**
 * INTÉGRATION POS SHELL - "3. DATA SOURCE" / "4. ONLINE" / "5. OFFLINE".
 *
 * The Bearer/cross-origin sibling of lib/offline/driver-pos/pos-data-
 * source.ts's own loadDriverPosContext (used by the web app's driver-pos-
 * view.tsx) - same DriverPosContextDto shape either way, same fallback
 * order (server first, cache second), so the UI never needs an `if
 * (online) ... else ...` anywhere (this function IS that centralized
 * choice). Not a modification of that file: it uses a relative,
 * cookie-authenticated fetch tied to the web app's own origin, which cannot
 * work cross-origin from this shell - the actual CACHE reconstruction
 * (loadCachedDriverPosContext) and cache MIRRORING (hydrateDriverOfflineCache)
 * are reused HERE unchanged; only the network transport differs.
 */

export type ShellDriverPosContextResult =
  | { ok: true; source: "server"; context: DriverPosContextDto; cacheSyncedAt: null }
  | { ok: true; source: "cache"; context: DriverPosContextDto; cacheSyncedAt: string }
  | { ok: false; reason: "NOT_FOUND" | "ERROR" };

export async function loadShellDriverPosContext(params: {
  token: string | null;
  organizationId: string;
  organizationName: string | null;
  userId: string;
  userName: string;
  driverId: string;
  customerId?: string | null;
}): Promise<ShellDriverPosContextResult> {
  if (params.token) {
    const query = params.customerId ? `?customerId=${encodeURIComponent(params.customerId)}` : "";
    const outcome = await mobileFetch<{ context: DriverPosContextDto }>(
      `/api/driver/pos${query}`,
      params.token,
    );
    if (outcome.kind === "ok") {
      // Mirror into SQLite exactly like the web app does - same function,
      // same shape, so a later cold-start offline read sees the same data
      // regardless of which app actually talked to the server. skipCustomers
      // Cache:true - BUG-01 "CLIENTS OFFLINE": this shell maintains its OWN
      // complete customers cache (refreshFullDriverCustomerCache, called
      // separately below by PosScreen) - letting this call ALSO write
      // cached_customers with GET /api/driver/pos's small 20-item preload
      // raced that fuller write with no ordering guarantee and could
      // silently clobber it back down to 20 - see hydrateDriverOfflineCache's
      // own doc comment on this flag.
      void hydrateDriverOfflineCache({
        organizationId: params.organizationId,
        organizationName: params.organizationName,
        userId: params.userId,
        userName: params.userName,
        context: outcome.data.context,
        skipCustomersCache: true,
      });
      return { ok: true, source: "server", context: outcome.data.context, cacheSyncedAt: null };
    }
    // unauthorized/network_error/server_error - fall through to the cache,
    // exactly like pos-data-source.ts's own catch block. A 401 here is
    // surfaced separately by the shell's own auth-state machine (this
    // function's job is only the POS data, never token lifecycle).
  }

  const cached = await loadCachedDriverPosContext({
    organizationId: params.organizationId,
    driverId: params.driverId,
  });
  if (cached.status === "FOUND") {
    return { ok: true, source: "cache", context: cached.context, cacheSyncedAt: cached.syncedAt };
  }
  return { ok: false, reason: cached.status === "ERROR" ? "ERROR" : "NOT_FOUND" };
}

/**
 * CORRECTION "CLIENTS ONLINE MAIS RECHERCHE IMPOSSIBLE" - "2./3./4. CACHE
 * COMPLET CLIENTS": GET /api/driver/pos's `context.customers` is a small,
 * bounded preload (POS_CUSTOMER_PRELOAD_LIMIT = 20 - see
 * getPosCustomerPreload in lib/server/customers.ts), kept deliberately small
 * for a fast POS boot - not meant to be the offline SEARCH source. This
 * calls the separate, already-existing, already-unbounded
 * GET /api/driver/customers (getCustomersForCurrentDriver - identical
 * organizationId + "ADMIN-origin OR created by this driver" access rule,
 * just no LIMIT) and overwrites cached_customers with the complete result,
 * so an offline restart's loadCachedDriverPosContext later reconstructs
 * `context.customers` from that same complete set.
 *
 * Best-effort and additive only: on any failure (offline, CORS, 401, 5xx)
 * this returns null and does NOT touch cached_customers - the previously
 * cached list (the 20-preload from hydrateDriverOfflineCache, or an earlier
 * successful call to this function) is left exactly as it was. Never called
 * with a partial or empty list.
 */
export async function refreshFullDriverCustomerCache(params: {
  token: string | null;
  organizationId: string;
  driverId: string;
}): Promise<CustomerDto[] | null> {
  const scope = { organizationId: params.organizationId, driverId: params.driverId };
  if (!params.token) return null;
  const outcome = await mobileFetch<{ customers: CustomerDto[] }>("/api/driver/customers", params.token);
  if (outcome.kind !== "ok" || !outcome.data?.customers) return null;

  const customers = outcome.data.customers;
  if (import.meta.env.DEV) {
    console.log("[OFFLINE CUSTOMERS] server count =", customers.length, scope);
  }

  const saved = await saveCachedCustomers(
    scope,
    customers.map((customer) => ({
      id: customer.id,
      code: customer.code,
      name: customer.name,
      phone: customer.phone ?? null,
      status: customer.status,
    })),
  );
  if (import.meta.env.DEV) {
    console.log("[OFFLINE CUSTOMERS] cache write count =", saved ? customers.length : 0, scope);
    if (saved) {
      const rowsAfterWrite = await getCachedCustomers(scope);
      console.log("[OFFLINE CUSTOMERS] cache read after write =", rowsAfterWrite.length, scope);
    }
  }
  return saved ? customers : null;
}

/**
 * CORRECTION "FINALISATION PIPELINE OFFLINE V1" - "7./8. SYNCHRONISATION":
 * the shared syncPendingDriverSales (lib/offline/driver-pos/sync-sales.ts)
 * posts to a same-origin, cookie-authenticated endpoint by default - correct
 * for the web app, broken for this shell (cross-origin, Bearer-only, no
 * cookie). This supplies ONLY the transport (absolute URL + Authorization
 * header) via that function's own optional `transport` parameter - every
 * other guarantee (ordering, single-flight, status transitions, error
 * classification, idempotency) is the exact same engine, never duplicated.
 * Used by both the manual "Synchroniser" button and the OFFLINE->ONLINE/
 * boot-with-pending auto-trigger (see App.tsx) - both calls share the same
 * underlying single-flight promise, so they can never run concurrently.
 */
export async function syncPendingDriverSalesForShell(
  scope: { organizationId: string; driverId: string },
  token: string | null,
): Promise<SyncBatchResult> {
  return syncPendingDriverSales(scope, {
    endpoint: apiUrl("/api/driver/sales/sync"),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
