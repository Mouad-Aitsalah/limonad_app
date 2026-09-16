"use client";

/**
 * PHASE 4B.1 - "SYNCHRONISATION SQLITE -> SERVEUR, DÉCLENCHEMENT MANUEL".
 *
 * Sends each still-local offline sale to POST /api/driver/sales/sync
 * (see lib/server/driver-sales.ts's syncOfflineDriverSale) ONE AT A TIME -
 * never Promise.all, so a driver never fires N simultaneous requests for
 * something the server already treats as a strictly one-sale-per-call
 * endpoint, and so a stop-on-401 (see "8. AUTH 401") can actually take
 * effect before the next sale is attempted.
 *
 * PHASE 4B.2 update: this module itself is UNCHANGED - the manual button
 * and the OFFLINE->ONLINE auto-trigger (see driver-pos-view.tsx's own
 * handleSyncPendingSales) both call this exact same syncPendingDriverSales,
 * so every guarantee below (single-flight, sequential/soldAt-ordered,
 * status transitions, outbox handling, idempotency) applies identically no
 * matter which one triggered it - there is no separate "auto" code path
 * here to keep in sync with this one.
 *
 * CORRECTION "FINALISATION PIPELINE OFFLINE V1" - "7./8. TRANSPORT": the
 * mobile driver shell (mobile/driver/) calls this SAME function - it must
 * never fork/duplicate this engine (ordering, single-flight, status
 * transitions, error classification would drift out of sync between two
 * copies). Its only real difference from the web app is the network
 * transport: cross-origin (needs an absolute URL + CORS) and Bearer-
 * authenticated (no session cookie). `transport` is optional and additive -
 * the web app's own call sites (no second argument) are byte-for-byte
 * identical to before this change: same relative URL, same headers, same
 * cookie auth. See mobile/driver/src/lib/driver-pos-data-source.ts's
 * syncPendingDriverSalesForShell for the shell's own transport.
 */

import { deleteOutboxEntriesForEntity } from "./outbox-store";
import {
  getOfflineSales,
  markOfflineSaleRequiresReview,
  markOfflineSaleSynced,
  markOfflineSaleSyncError,
  markOfflineSaleSyncing,
  reapStaleSyncingSales,
  revertOfflineSaleToPending,
} from "./sales-store";
import type { OfflineSaleWithLines } from "./types";

const SYNC_ENDPOINT = "/api/driver/sales/sync";
const FETCH_TIMEOUT_MS = 20000;

// "9. ERREURS MÉTIER PERMANENTES" - exact list from that task, plus the two
// payload-shape codes from Phase 4A/4A.1 that are equally permanent (a
// malformed quantity/price will never become valid by merely retrying).
// Anything NOT in this set (network failures, 5xx, an unrecognised code) is
// treated as transient - see "7. ERREURS TRANSITOIRES" - the safer default
// when unsure, since a wrongly-transient sale can still be retried by hand,
// while a wrongly-permanent one would silently stop being retried at all.
const PERMANENT_ERROR_CODES = new Set([
  "LEGACY_OFFLINE_PRICE_MISMATCH",
  "INVALID_OFFLINE_PRICE_TOKEN",
  "PRODUCT_NOT_FOUND",
  "CUSTOMER_NOT_FOUND",
  "UNSUPPORTED_OFFLINE_PAYMENT_METHOD",
  "INVALID_SOLD_AT",
  "INVALID_QUANTITY",
  "INVALID_PRICE",
]);

export type SyncedSale = {
  localId: string;
  localReference: string;
  serverSaleId: string;
  officialDisplayNumber: string;
};

export type SyncFailedSale = {
  localId: string;
  localReference: string;
  message: string;
};

export type SyncBatchResult = {
  attempted: number;
  synced: SyncedSale[];
  transientErrors: SyncFailedSale[];
  requiresReview: SyncFailedSale[];
  /** True if the batch stopped early because the server returned 401/
   *  AUTH_REQUIRED - see "8. AUTH 401". Every sale from that point on
   *  (inclusive) was left untouched (still PENDING_SYNC/SYNC_ERROR). */
  stoppedForAuth: boolean;
};

/** Optional transport override - see this module's own doc comment ("7./8.
 *  TRANSPORT"). Omitted entirely (every existing web-app call site), this is
 *  the exact same relative URL + no extra headers as before this change. */
export type SyncTransportOptions = {
  /** Absolute URL to POST to instead of the same-origin SYNC_ENDPOINT. */
  endpoint?: string;
  /** Extra headers merged in - e.g. { Authorization: "Bearer <token>" }. */
  headers?: Record<string, string>;
};

type SyncOutcome =
  | { kind: "success"; serverSaleId: string; officialDisplayNumber: string }
  | { kind: "auth_required"; message: string }
  | { kind: "permanent"; message: string }
  | { kind: "transient"; message: string };

async function classifyResponse(response: Response): Promise<SyncOutcome> {
  let body: Record<string, unknown> | null = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (a proxy/edge error page, etc.) - fall through to the
    // generic transient classification below.
  }
  const code = typeof body?.code === "string" ? body.code : undefined;
  const message = typeof body?.message === "string" ? body.message : `Erreur serveur (${response.status}).`;

  if (response.status === 401 || code === "AUTH_REQUIRED") {
    return { kind: "auth_required", message };
  }
  if (response.ok && body?.success === true) {
    const serverSaleId = typeof body.serverSaleId === "string" ? body.serverSaleId : null;
    const officialDisplayNumber =
      typeof body.officialDisplayNumber === "string" ? body.officialDisplayNumber : null;
    if (serverSaleId && officialDisplayNumber) {
      // "success"/"serverSaleId"/"officialDisplayNumber" are the ONLY
      // fields this client trusts to decide the sale is really synced -
      // never `result` (CREATED vs ALREADY_SYNCED), see "5. SUCCÈS SERVEUR".
      return { kind: "success", serverSaleId, officialDisplayNumber };
    }
    return { kind: "transient", message: "Reponse serveur incomplete." };
  }
  if (code && PERMANENT_ERROR_CODES.has(code)) {
    return { kind: "permanent", message };
  }
  return { kind: "transient", message };
}

async function syncOneSale(
  sale: OfflineSaleWithLines,
  transport?: SyncTransportOptions,
): Promise<SyncOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(transport?.endpoint ?? SYNC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(transport?.headers ?? {}) },
      // "3. PAYLOAD SERVEUR" - exactly the fields Phase 4A expects. Never
      // organizationId/driverId/truckId/stockLocationId/totalTTC/an official
      // number - those are either server-derived from the session or
      // recalculated server-side, never trusted from this device.
      body: JSON.stringify({
        clientMutationId: sale.clientMutationId,
        localReference: sale.localReference,
        soldAt: sale.soldAt,
        customerId: sale.customerId,
        paymentMethod: sale.paymentMethod,
        lines: sale.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPriceTTC: line.unitPriceSnapshot,
          priceToken: line.priceToken,
        })),
      }),
      signal: controller.signal,
    });
    return await classifyResponse(response);
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "Delai d'attente depasse."
        : error instanceof Error
          ? error.message
          : "Erreur reseau.";
    return { kind: "transient", message };
  } finally {
    clearTimeout(timeout);
  }
}

async function runSyncBatch(
  scope: { organizationId: string; driverId: string },
  transport?: SyncTransportOptions,
): Promise<SyncBatchResult> {
  // "13. CRASH ENTRE SERVEUR ET SQLITE" - must run BEFORE reading
  // offline_sales below, so a row orphaned in SYNCING by a previous crashed
  // process is already back to PENDING_SYNC (and therefore included in
  // `toSync`) by the time this batch decides what to send - see
  // reapStaleSyncingSales's own doc comment for why this can never mistake
  // a live in-progress row for a stale one.
  const reaped = await reapStaleSyncingSales(scope);
  if (reaped > 0) console.log("[SYNC RECOVERED]", { count: reaped });

  const allSales = await getOfflineSales(scope);
  const toSync = allSales
    .filter((sale) => sale.syncStatus === "PENDING_SYNC" || sale.syncStatus === "SYNC_ERROR")
    // "2. CRÉER LE MOTEUR DE SYNC" - soldAt ASC, then createdAtLocal ASC.
    .sort((a, b) => {
      const bySoldAt = new Date(a.soldAt).getTime() - new Date(b.soldAt).getTime();
      if (bySoldAt !== 0) return bySoldAt;
      return new Date(a.createdAtLocal).getTime() - new Date(b.createdAtLocal).getTime();
    });

  const result: SyncBatchResult = {
    attempted: 0,
    synced: [],
    transientErrors: [],
    requiresReview: [],
    stoppedForAuth: false,
  };

  console.log("[SYNC START]", { count: toSync.length });
  if (toSync.length === 0) return result;

  // Sequential, deliberately - "2. ... Les ventes doivent être envoyées UNE
  // PAR UNE. Pas de Promise.all." Also what makes stopping on 401 possible.
  for (const sale of toSync) {
    result.attempted += 1;
    await markOfflineSaleSyncing(sale.localId);

    const outcome = await syncOneSale(sale, transport);

    if (outcome.kind === "success") {
      await markOfflineSaleSynced(sale.localId, {
        serverSaleId: outcome.serverSaleId,
        officialDisplayNumber: outcome.officialDisplayNumber,
      });
      // "IMPORTANT: NE PAS décrémenter le stock SQLite une deuxième fois" -
      // this never touches cached_truck_stock, only offline_sales/sync_outbox.
      await deleteOutboxEntriesForEntity(sale.localId);
      result.synced.push({
        localId: sale.localId,
        localReference: sale.localReference,
        serverSaleId: outcome.serverSaleId,
        officialDisplayNumber: outcome.officialDisplayNumber,
      });
      console.log("[SYNC SUCCESS]", {
        localId: sale.localId,
        clientMutationId: sale.clientMutationId,
        officialDisplayNumber: outcome.officialDisplayNumber,
      });
      continue;
    }

    if (outcome.kind === "auth_required") {
      // "8. AUTH 401" - never this sale's fault: revert to PENDING_SYNC
      // (not SYNC_ERROR), stop the whole batch, never touch the outbox.
      await revertOfflineSaleToPending(sale.localId);
      result.stoppedForAuth = true;
      console.log("[SYNC FAILED]", { localId: sale.localId, clientMutationId: sale.clientMutationId, status: "AUTH_REQUIRED" });
      break;
    }

    if (outcome.kind === "permanent") {
      await markOfflineSaleRequiresReview(sale.localId, outcome.message);
      result.requiresReview.push({
        localId: sale.localId,
        localReference: sale.localReference,
        message: outcome.message,
      });
      console.log("[SYNC FAILED]", { localId: sale.localId, clientMutationId: sale.clientMutationId, status: "REQUIRES_REVIEW" });
      // "9. ... Une seule vente problématique ne doit pas nécessairement
      // bloquer toutes les autres." - continue with the next one.
      continue;
    }

    // transient
    await markOfflineSaleSyncError(sale.localId, outcome.message);
    result.transientErrors.push({
      localId: sale.localId,
      localReference: sale.localReference,
      message: outcome.message,
    });
    console.log("[SYNC RETRY]", { localId: sale.localId, clientMutationId: sale.clientMutationId, status: "SYNC_ERROR" });
  }

  return result;
}

// "10. SINGLE-FLIGHT / CONCURRENCE CLIENT" - a second call while one batch
// is already running joins the SAME in-flight promise instead of starting
// its own loop (same memoized-promise idiom as database.ts's getDatabase()).
let syncInFlight: Promise<SyncBatchResult> | null = null;

export function isSyncInFlight(): boolean {
  return syncInFlight !== null;
}

export async function syncPendingDriverSales(
  scope: { organizationId: string; driverId: string },
  transport?: SyncTransportOptions,
): Promise<SyncBatchResult> {
  if (syncInFlight) {
    console.log("[SYNC ALREADY RUNNING]");
    return syncInFlight;
  }
  const run = runSyncBatch(scope, transport).finally(() => {
    syncInFlight = null;
  });
  syncInFlight = run;
  return run;
}
