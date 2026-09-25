"use client";

/**
 * COUNTER POS - initial / refresh download of the reference data
 * (Phase 3): `syncPosData(scope)`.
 *
 * WHAT IT DOES, in order (every request is an EXISTING endpoint, same-origin,
 * cookie-authenticated, GET, with a timeout):
 *
 *   1. network check          OFFLINE / SERVER_UNREACHABLE -> stop, touch nothing
 *   2. identity guard         GET /api/auth/session must be THIS user in THIS
 *                             organization with a counter-POS role
 *   3. POS context            GET /api/sales/context - depot, stock location,
 *                             bank accounts, default customer, first 500
 *                             products with stock. ESSENTIAL.
 *   4. full catalogue         only if the context was truncated: page through
 *                             GET /api/products/list?status=ACTIVE and take the
 *                             depot stock from GET /api/stock/locations/{id}.
 *   5. full customer list     GET /api/customers, active ones only
 *   6. organization identity  GET /api/organization/identity
 *   7. ONE atomic write       hydrateCounterPosSnapshot: everything or nothing
 *
 * GUARANTEES
 *   - Organization-scoped: the organization always comes from the caller's own
 *     session on the server; the identity guard and the identity response's id
 *     make a mix-up (another login in another tab) abort BEFORE any write.
 *   - Idempotent: running it twice on unchanged data changes nothing but the
 *     timestamps. A failed run never writes, so it never corrupts.
 *   - Deletions / deactivations: a COMPLETE download removes what the server
 *     no longer lists (deactivated or deleted products, customers). A partial
 *     one (context truncated and the catalogue pages failed; customer list
 *     failed) removes nothing - absence proves nothing - and says so in
 *     `warnings`.
 *   - Only essential steps abort the sync. A failed catalogue-pages / customer
 *     list / identity request degrades to a warning and the previous data of
 *     that kind is kept. An auth/forbidden/identity failure at ANY step aborts
 *     everything, since nothing fetched after it can be trusted.
 *   - Untrusted input: every response is validated (sync-schemas.ts) and
 *     size-capped before it is used.
 *
 * Nothing here is wired into components/pos yet, and no sale is touched.
 */

import { assertScope, CounterPosStoreError, isIndexedDbAvailable } from "./database";
import { getNetworkState as defaultGetNetworkState, subscribeToNetworkState, type NetworkState } from "./network-status";
import { hydrateCounterPosSnapshot, type CounterPosSnapshotInput } from "./pos-data-source";
import type {
  CounterPosScope,
  StoreErrorCode,
  StoreResult,
  SyncStateRecord,
  SyncSummary,
  SyncWarning,
} from "./schema";
import {
  contextResponseSchema,
  customersResponseSchema,
  describeSchemaIssue,
  identityResponseSchema,
  posProductFromListProduct,
  productPageSchema,
  sessionResponseSchema,
  stockLocationResponseSchema,
  type ListProduct,
} from "./sync-schemas";
import { getPosSyncState, markPosSyncFailed, markPosSyncStarted, markPosSyncSucceeded } from "./sync-state-store";
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Limits (untrusted input must be bounded)
// ---------------------------------------------------------------------------

export const SYNC_REQUEST_TIMEOUT_MS = 20_000;
/** getProductsPage clamps to 100 server-side. */
export const CATALOGUE_PAGE_SIZE = 100;
export const MAX_SYNC_PRODUCTS = 20_000;
export const MAX_SYNC_CUSTOMERS = 50_000;
export const MAX_SYNC_STOCK_LEVELS = 100_000;

/** The roles that may use the counter POS (getCounterPosContext's own list). */
const COUNTER_POS_ROLES: readonly string[] = ["admin", "depot_manager", "cashier"];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SyncFailureCode =
  | "OFFLINE"
  | "SERVER_UNREACHABLE"
  | "TIMEOUT"
  | "NETWORK"
  | "SERVER_ERROR"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "IDENTITY_MISMATCH"
  | "INVALID_RESPONSE"
  | "TOO_LARGE"
  | StoreErrorCode;

export type SyncPosDataResult =
  | {
      ok: true;
      syncedAt: string;
      summary: SyncSummary;
      warnings: SyncWarning[];
      catalogueComplete: boolean;
      customersComplete: boolean;
    }
  | {
      ok: false;
      code: SyncFailureCode;
      message: string;
      /** Whether trying again later could succeed without any user action. */
      retryable: boolean;
      httpStatus: number | null;
    };

export type SyncPosDataDeps = {
  fetchFn?: typeof fetch;
  getNetworkState?: () => Promise<NetworkState>;
  now?: () => Date;
  requestTimeoutMs?: number;
  pageSize?: number;
  maxProducts?: number;
  maxCustomers?: number;
};

class SyncFailure extends Error {
  constructor(
    public readonly code: SyncFailureCode,
    message: string,
    public readonly retryable: boolean,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "SyncFailure";
  }
}

/** Failures that mean "everything fetched from here on cannot be trusted". */
function isFatalEverywhere(failure: SyncFailure): boolean {
  return (
    failure.code === "AUTH_REQUIRED" ||
    failure.code === "FORBIDDEN" ||
    failure.code === "IDENTITY_MISMATCH"
  );
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function requestJson<T extends z.ZodType>(
  url: string,
  schema: T,
  deps: Required<Pick<SyncPosDataDeps, "requestTimeoutMs">> & { fetchFn: typeof fetch },
): Promise<z.infer<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.requestTimeoutMs);
  let response: Response;
  try {
    const { fetchFn } = deps; // plain call: a detached native fetch must not get `deps` as `this`
    response = await fetchFn(url, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SyncFailure("TIMEOUT", "Le serveur ne repond pas a temps.", true);
    }
    throw new SyncFailure("NETWORK", "Erreur reseau pendant la synchronisation.", true);
  } finally {
    clearTimeout(timer);
  }

  const status = response.status;
  if (status === 401) throw new SyncFailure("AUTH_REQUIRED", "Session expiree. Reconnectez-vous.", false, status);
  if (status === 403) throw new SyncFailure("FORBIDDEN", "Acces refuse.", false, status);

  const contentType = response.headers?.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    // A captive portal or a proxy error page, not our API.
    throw new SyncFailure("SERVER_UNREACHABLE", "Reponse inattendue (pas du JSON).", true, status);
  }
  if (status >= 500 || status === 408 || status === 429) {
    throw new SyncFailure("SERVER_ERROR", `Erreur serveur (${status}).`, true, status);
  }
  if (status >= 400) {
    throw new SyncFailure("SERVER_ERROR", `Requete refusee (${status}).`, false, status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SyncFailure("INVALID_RESPONSE", "Reponse illisible.", false, status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SyncFailure("INVALID_RESPONSE", `Reponse invalide (${describeSchemaIssue(parsed.error)}).`, false, status);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<SyncPosDataResult>>();

/**
 * Downloads the counter POS reference data and mirrors it locally. Concurrent
 * calls for the same (organization, user) share ONE run. Never throws.
 */
export function syncPosData(
  scope: CounterPosScope,
  deps: SyncPosDataDeps = {},
): Promise<SyncPosDataResult> {
  const key = `${scope?.organizationId}\u0000${scope?.userId}`;
  const running = inFlight.get(key);
  if (running) return running;
  const promise = runSync(scope, deps).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function isPosSyncRunning(scope: CounterPosScope): boolean {
  return inFlight.has(`${scope?.organizationId}\u0000${scope?.userId}`);
}

function failureResult(failure: SyncFailure): SyncPosDataResult {
  return {
    ok: false,
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    httpStatus: failure.httpStatus,
  };
}

async function runSync(scope: CounterPosScope, deps: SyncPosDataDeps): Promise<SyncPosDataResult> {
  try {
    assertScope(scope);
  } catch (error) {
    return failureResult(
      new SyncFailure("INVALID_INPUT", error instanceof Error ? error.message : "Perimetre invalide.", false),
    );
  }
  if (!isIndexedDbAvailable()) {
    return failureResult(new SyncFailure("INDEXEDDB_UNAVAILABLE", "Le stockage local est indisponible.", false));
  }

  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const getState = deps.getNetworkState ?? (() => defaultGetNetworkState());

  const state = await getState();
  if (state !== "ONLINE") {
    const failure = new SyncFailure(
      state === "OFFLINE" ? "OFFLINE" : "SERVER_UNREACHABLE",
      state === "OFFLINE" ? "Pas de connexion Internet." : "Le serveur est injoignable.",
      true,
    );
    await recordFailure(scope, failure, startedAt);
    return failureResult(failure);
  }

  const started = await markPosSyncStarted(scope, startedAt);
  if (!started.ok) {
    return failureResult(new SyncFailure(started.code, started.message, false));
  }

  try {
    const outcome = await download(scope, deps, startedAt);
    const finishedAt = now();
    const summary: SyncSummary = { ...outcome.summary, durationMs: finishedAt.getTime() - startedAt.getTime() };
    const recorded = await markPosSyncSucceeded(
      scope,
      {
        summary,
        warnings: outcome.warnings,
        catalogueComplete: outcome.catalogueComplete,
        customersComplete: outcome.customersComplete,
      },
      finishedAt,
    );
    if (!recorded.ok) {
      // The data IS written; only the bookkeeping failed. Report success, say so.
      console.warn("[COUNTER POS SYNC] data written but the sync state could not be saved:", recorded.message);
    }
    return {
      ok: true,
      syncedAt: finishedAt.toISOString(),
      summary,
      warnings: outcome.warnings,
      catalogueComplete: outcome.catalogueComplete,
      customersComplete: outcome.customersComplete,
    };
  } catch (error) {
    const failure =
      error instanceof SyncFailure
        ? error
        : new SyncFailure("STORAGE_ERROR", error instanceof Error ? error.message : "Erreur inattendue.", false);
    await recordFailure(scope, failure, now());
    return failureResult(failure);
  }
}

async function recordFailure(scope: CounterPosScope, failure: SyncFailure, at: Date): Promise<void> {
  const recorded = await markPosSyncFailed(
    scope,
    {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      httpStatus: failure.httpStatus,
    },
    at,
  );
  if (!recorded.ok) {
    console.warn("[COUNTER POS SYNC] failure could not be recorded:", recorded.message);
  }
}

type DownloadOutcome = {
  summary: Omit<SyncSummary, "durationMs">;
  warnings: SyncWarning[];
  catalogueComplete: boolean;
  customersComplete: boolean;
};

async function download(
  scope: CounterPosScope,
  deps: SyncPosDataDeps,
  startedAt: Date,
): Promise<DownloadOutcome> {
  const http = {
    fetchFn: deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args)),
    requestTimeoutMs: deps.requestTimeoutMs ?? SYNC_REQUEST_TIMEOUT_MS,
  };
  const pageSize = deps.pageSize ?? CATALOGUE_PAGE_SIZE;
  const maxProducts = deps.maxProducts ?? MAX_SYNC_PRODUCTS;
  const maxCustomers = deps.maxCustomers ?? MAX_SYNC_CUSTOMERS;
  const warnings: SyncWarning[] = [];

  // 2. identity guard --------------------------------------------------------
  const session = await requestJson("/api/auth/session", sessionResponseSchema, http);
  if (!session.user) throw new SyncFailure("AUTH_REQUIRED", "Session expiree. Reconnectez-vous.", false);
  if (session.user.id !== scope.userId || session.user.organizationId !== scope.organizationId) {
    throw new SyncFailure(
      "IDENTITY_MISMATCH",
      "La session ouverte n'est pas celle de ce poste (autre utilisateur ou autre organisation).",
      false,
    );
  }
  if (!COUNTER_POS_ROLES.includes(session.user.role)) {
    throw new SyncFailure("FORBIDDEN", "Ce role n'utilise pas le POS comptoir.", false);
  }

  // 3. POS context (essential) ----------------------------------------------
  const { context } = await requestJson("/api/sales/context", contextResponseSchema, http);
  if (context.user.id !== scope.userId) {
    throw new SyncFailure("IDENTITY_MISMATCH", "Le contexte POS recu appartient a un autre utilisateur.", false);
  }
  if (context.products.length > maxProducts || context.customers.length > maxCustomers) {
    throw new SyncFailure("TOO_LARGE", "Le contexte POS depasse les limites de synchronisation.", false);
  }

  let products = context.products;
  let productsTruncated = context.productsTruncated;
  let catalogueSource: SyncSummary["catalogueSource"] = "context";

  // 4. full catalogue, only when the context was truncated ------------------
  if (context.productsTruncated) {
    try {
      products = await downloadFullCatalogue(context.stockLocation.id, http, pageSize, maxProducts);
      productsTruncated = false;
      catalogueSource = "catalogue-pages";
    } catch (error) {
      const failure = asFailure(error);
      if (isFatalEverywhere(failure)) throw failure;
      warnings.push({
        code: "CATALOGUE_INCOMPLETE",
        message: `Catalogue complet indisponible (${failure.message}). Seuls les premiers produits sont a jour, rien n'a ete supprime.`,
      });
    }
  }

  // 5. full customer list ----------------------------------------------------
  let customers: CounterPosSnapshotInput["customers"] = context.customers;
  let customersComplete = false;
  try {
    const all = await requestJson("/api/customers", customersResponseSchema, http);
    if (all.customers.length > maxCustomers) {
      throw new SyncFailure("TOO_LARGE", "La liste des clients depasse la limite de synchronisation.", false);
    }
    const active = all.customers.filter((customer) => customer.status === "ACTIVE");
    // The default customer is always active server-side; if the full list does
    // not contain it something is off - keep the list partial rather than
    // deleting the customer the POS pre-selects.
    if (context.defaultCustomerId && !active.some((c) => c.id === context.defaultCustomerId)) {
      throw new SyncFailure("INVALID_RESPONSE", "Le client par defaut est absent de la liste des clients.", false);
    }
    customers = active;
    customersComplete = true;
  } catch (error) {
    const failure = asFailure(error);
    if (isFatalEverywhere(failure)) throw failure;
    warnings.push({
      code: "CUSTOMERS_INCOMPLETE",
      message: `Liste complete des clients indisponible (${failure.message}). Les clients deja en cache sont conserves.`,
    });
  }

  // 6. organization identity -------------------------------------------------
  let organization: { name: string; tradeName: string | null; logoUrl: string | null } | undefined;
  try {
    const { identity } = await requestJson("/api/organization/identity", identityResponseSchema, http);
    if (identity.id !== scope.organizationId) {
      throw new SyncFailure("IDENTITY_MISMATCH", "L'identite recue appartient a une autre organisation.", false);
    }
    organization = {
      name: identity.name,
      tradeName: identity.tradeName ?? null,
      logoUrl: identity.logoUrl ?? null,
    };
  } catch (error) {
    const failure = asFailure(error);
    if (isFatalEverywhere(failure)) throw failure;
    warnings.push({
      code: "ORGANIZATION_INFO_UNAVAILABLE",
      message: `Informations de l'organisation indisponibles (${failure.message}). Les anciennes sont conservees.`,
    });
  }

  // 7. one atomic write ------------------------------------------------------
  const written = await hydrateCounterPosSnapshot(
    scope,
    { ...context, products, productsTruncated, customers },
    { now: startedAt, organization, customersComplete },
  );
  if (!written.ok) throw new SyncFailure(written.code, written.message, false);

  return {
    summary: {
      products: written.value.products,
      customers: written.value.customers,
      stockLevels: written.value.stockLevels,
      catalogueSource,
    },
    warnings,
    catalogueComplete: !productsTruncated,
    customersComplete,
  };
}

function asFailure(error: unknown): SyncFailure {
  if (error instanceof SyncFailure) return error;
  if (error instanceof CounterPosStoreError) return new SyncFailure(error.code, error.message, false);
  return new SyncFailure("NETWORK", error instanceof Error ? error.message : "Erreur inattendue.", true);
}

/** Pages GET /api/products/list?status=ACTIVE, then joins the depot stock. */
async function downloadFullCatalogue(
  stockLocationId: string,
  http: Parameters<typeof requestJson>[2],
  pageSize: number,
  maxProducts: number,
) {
  const items = new Map<string, ListProduct>();
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  do {
    const query = new URLSearchParams({ status: "ACTIVE", pageSize: String(pageSize) });
    if (cursor) query.set("cursor", cursor);
    const page: z.infer<typeof productPageSchema> = await requestJson(
      `/api/products/list?${query.toString()}`,
      productPageSchema,
      http,
    );
    for (const item of page.items) {
      // The server was asked for ACTIVE only; never trust that alone.
      if (item.status === "ACTIVE") items.set(item.id, item);
    }
    if (items.size > maxProducts) {
      throw new SyncFailure("TOO_LARGE", "Le catalogue depasse la limite de synchronisation.", false);
    }
    const next: string | null = page.hasMore ? page.nextCursor : null;
    if (next !== null && seenCursors.has(next)) {
      throw new SyncFailure("INVALID_RESPONSE", "La pagination du catalogue ne progresse pas.", false);
    }
    if (next !== null) seenCursors.add(next);
    cursor = next;
  } while (cursor !== null);

  const stock = await requestJson(
    `/api/stock/locations/${encodeURIComponent(stockLocationId)}`,
    stockLocationResponseSchema,
    http,
  );
  if (stock.levels.length > MAX_SYNC_STOCK_LEVELS) {
    throw new SyncFailure("TOO_LARGE", "Le stock du depot depasse la limite de synchronisation.", false);
  }
  const available = new Map<string, number>();
  for (const level of stock.levels) {
    // Only this depot's rows count, whatever the endpoint returned.
    if (level.locationId === stockLocationId) available.set(level.productId, level.availableQuantity);
  }
  return [...items.values()].map((product) => posProductFromListProduct(product, available));
}

// ---------------------------------------------------------------------------
// Automatic refresh
// ---------------------------------------------------------------------------

export type PosAutoSyncOptions = {
  /** Sync again once the data is older than this. Default 10 minutes. */
  minIntervalMs?: number;
  /** How often staleness is checked while online. Default 5 minutes. 0 = off. */
  checkEveryMs?: number;
  /** After a retryable failure, wait at least this long. Default 60 s. */
  retryAfterFailureMs?: number;
  now?: () => Date;
  /** Injection points (tests). */
  subscribe?: typeof subscribeToNetworkState;
  sync?: (scope: CounterPosScope) => Promise<SyncPosDataResult>;
  readState?: (scope: CounterPosScope) => Promise<StoreResult<SyncStateRecord>>;
  onResult?: (result: SyncPosDataResult) => void;
};

/**
 * Keeps the local data fresh without the UI having to ask: syncs when the PC
 * comes (back) online and re-checks staleness periodically while online.
 * Returns a stop function. It never syncs while offline, never more often than
 * `retryAfterFailureMs` after a failure, and never retries automatically a
 * failure that needs a person (expired session, wrong organization) - those
 * wait for `minIntervalMs`, by when the user has likely logged in again.
 */
export function startPosDataAutoSync(
  scope: CounterPosScope,
  options: PosAutoSyncOptions = {},
): () => void {
  const minIntervalMs = options.minIntervalMs ?? 10 * 60_000;
  const checkEveryMs = options.checkEveryMs ?? 5 * 60_000;
  const retryAfterFailureMs = options.retryAfterFailureMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  const subscribe = options.subscribe ?? subscribeToNetworkState;
  const sync = options.sync ?? ((s: CounterPosScope) => syncPosData(s));
  const readState = options.readState ?? ((s: CounterPosScope) => getPosSyncState(s));

  let stopped = false;
  let online = false;
  let busy = false;

  async function maybeSync() {
    if (stopped || !online || busy) return;
    busy = true;
    try {
      const read = await readState(scope);
      if (stopped) return;
      const state = read.ok ? read.value : null;
      const t = now().getTime();
      const since = (iso: string | null) => (iso ? t - new Date(iso).getTime() : Number.POSITIVE_INFINITY);

      let due = true;
      if (state?.lastSyncAt && since(state.lastSyncAt) < minIntervalMs) due = false;
      if (state?.status === "FAILED" && state.lastError) {
        const wait = state.lastError.retryable ? retryAfterFailureMs : minIntervalMs;
        if (since(state.lastAttemptAt) < wait) due = false;
      }
      if (state?.status === "SYNCING" && since(state.startedAt) < 10 * 60_000) due = false;
      if (!due) return;

      const result = await sync(scope);
      if (!stopped) options.onResult?.(result);
    } finally {
      busy = false;
    }
  }

  const unsubscribe = subscribe(
    (networkState) => {
      online = networkState === "ONLINE";
      if (online) void maybeSync();
    },
    { intervalMs: checkEveryMs > 0 ? checkEveryMs : 0 },
  );
  const timer = checkEveryMs > 0 ? setInterval(() => void maybeSync(), checkEveryMs) : null;

  return () => {
    stopped = true;
    unsubscribe();
    if (timer) clearInterval(timer);
  };
}
