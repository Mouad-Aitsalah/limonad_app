"use client";

/**
 * COUNTER POS - synchronisation of offline sales (Phase 5).
 *
 * PENDING -> SYNCING -> SYNCED, one sale at a time, oldest first, through
 * POST /api/sales/sync (which ends in createCounterSale). Golden rule: a sale
 * becomes SYNCED only when the server ANSWERED with a confirmation carrying a
 * server sale id and an official number. Anything else - timeout, network
 * drop, 5xx, HTML error page, a 200 with a malformed body - is a failed
 * attempt, and because every attempt carries the same idempotencyKey, a retry
 * after an ambiguous failure can never create a second sale.
 *
 * Failure policy (see markSaleSyncFailure for backoff / budget):
 *   network / timeout / 5xx / 408 / 429 / unknown      retryable, PENDING + backoff
 *   business rejection (customer, product, validation) FAILED, precise message
 *   403 (not allowed)                                   FAILED, no retry loop
 *   401 (session expired)                               PAUSED: the sale goes back
 *       to PENDING WITHOUT counting an attempt, the run stops, and it resumes
 *       after the next login - a valid sale is not condemned by an expired cookie.
 *   after SYNC_MAX_ATTEMPTS attempts                    FAILED (no endless loop)
 * A network / server failure also STOPS the run: the remaining sales are not
 * hammered against a server that just failed.
 *
 * Concurrency: an in-process guard, a Web Lock (across tabs/windows of the
 * same PC) and, underneath, the atomic PENDING -> SYNCING claim per sale.
 * Crash recovery: under the lock nobody else can be syncing, so any SYNCING
 * row left by a closed tab is put back to PENDING first (and, if the server
 * had in fact created it, the replay answers ALREADY_SYNCED).
 */

import {
  claimSaleForSync,
  listOfflineSales,
  markSaleSynced,
  markSaleSyncFailure,
  reapStaleSyncingSales,
  revertSaleToPending,
} from "./sales-store";
import type { CounterPosScope, OfflineSaleWithDetails } from "./schema";

export const COUNTER_SYNC_ENDPOINT = "/api/sales/sync";
export const COUNTER_SYNC_TIMEOUT_MS = 30_000;

/** The wire contract; mirrored by counterSaleSyncSchema on the server. */
export type CounterSyncPayload = {
  localId: string;
  idempotencyKey: string;
  organizationId: string;
  userId: string;
  deviceId: string;
  localReference: string;
  soldAt: string;
  customerId: string | null;
  paymentMethod: "CASH" | "CHECK" | "BANK_TRANSFER" | "MIXED";
  reference: string | null;
  bankAccountingAccountId: string | null;
  payments: Array<{ method: string; amount: number; reference: string | null }>;
  totals: { totalTTC: number; paidAmount: number; creditAmount: number };
  lines: Array<{
    productId: string;
    quantity: number;
    discountUnitAmount: number;
    unitPriceHT?: number;
  }>;
  reservedSaleNumber: number | null;
  reservedSaleYear: number | null;
};

export function buildCounterSyncPayload(sale: OfflineSaleWithDetails): CounterSyncPayload {
  return {
    localId: sale.localId,
    idempotencyKey: sale.idempotencyKey,
    organizationId: sale.organizationId,
    userId: sale.userId,
    deviceId: sale.deviceId,
    localReference: sale.localReference,
    soldAt: sale.soldAt,
    customerId: sale.customerId,
    paymentMethod: sale.paymentMethod as CounterSyncPayload["paymentMethod"],
    reference: sale.reference,
    bankAccountingAccountId: sale.bankAccountingAccountId,
    payments: sale.payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference ?? null,
    })),
    totals: {
      totalTTC: sale.totalTTC,
      paidAmount: sale.paidAmount,
      creditAmount: sale.creditAmount,
    },
    lines: sale.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      discountUnitAmount: line.discountUnitAmount,
      // Only a manual price travels; otherwise the server uses its catalogue.
      ...(line.priceOverridden ? { unitPriceHT: line.unitPriceHT } : {}),
    })),
    reservedSaleNumber: sale.reservedSaleNumber,
    reservedSaleYear: sale.reservedSaleYear,
  };
}

export type SaleSyncOutcome =
  | { localId: string; outcome: "SYNCED"; officialDisplayNumber: string; duplicate: boolean; totalMismatch: boolean }
  | { localId: string; outcome: "RETRY_LATER"; code: string; message: string; retryAt: string | null }
  | { localId: string; outcome: "FAILED"; code: string; message: string }
  | { localId: string; outcome: "AUTH_PAUSED" }
  | { localId: string; outcome: "SKIPPED"; reason: string };

export type SyncSalesResult = {
  status: "DONE" | "NOTHING_TO_SYNC" | "ALREADY_RUNNING" | "STOPPED_NETWORK" | "STOPPED_SERVER" | "PAUSED_AUTH";
  attempted: number;
  synced: number;
  failed: number;
  retryLater: number;
  outcomes: SaleSyncOutcome[];
};

export type SyncSalesDeps = {
  fetchFn?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** Ignore the backoff delay (a manual "retry now"). */
  ignoreBackoff?: boolean;
  /** Cross-tab exclusion. Default: navigator.locks when available. Returns
   *  `undefined` when another holder owns the lock. */
  withLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T | undefined>;
};

const runningScopes = new Set<string>();

export function isCounterSalesSyncRunning(scope: CounterPosScope): boolean {
  return runningScopes.has(scopeKey(scope));
}

function scopeKey(scope: CounterPosScope): string {
  return `${scope.organizationId}:${scope.userId}`;
}

async function defaultWithLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) return fn();
  return locks.request(name, { ifAvailable: true }, async (lock) => (lock ? fn() : undefined));
}

type ServerBody = {
  success?: boolean;
  result?: string;
  serverSaleId?: unknown;
  officialDisplayNumber?: unknown;
  serverTotalTTC?: unknown;
  totalMismatch?: unknown;
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
};

export async function syncOfflineCounterSales(
  scope: CounterPosScope,
  deps: SyncSalesDeps = {},
): Promise<SyncSalesResult> {
  const result: SyncSalesResult = {
    status: "NOTHING_TO_SYNC",
    attempted: 0,
    synced: 0,
    failed: 0,
    retryLater: 0,
    outcomes: [],
  };
  const key = scopeKey(scope);
  if (runningScopes.has(key)) return { ...result, status: "ALREADY_RUNNING" };
  runningScopes.add(key);
  try {
    const withLock = deps.withLock ?? defaultWithLock;
    const done = await withLock(`comdis-counter-sales-sync:${key}`, () => run(scope, deps, result));
    return done === undefined ? { ...result, status: "ALREADY_RUNNING" } : done;
  } finally {
    runningScopes.delete(key);
  }
}

async function run(
  scope: CounterPosScope,
  deps: SyncSalesDeps,
  result: SyncSalesResult,
): Promise<SyncSalesResult> {
  const now = deps.now ?? (() => new Date());
  const fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
  const timeoutMs = deps.timeoutMs ?? COUNTER_SYNC_TIMEOUT_MS;

  // We hold the exclusive lock: a SYNCING row can only be a leftover of an
  // interrupted attempt. olderThanMs 0 = recover it right now.
  await reapStaleSyncingSales(scope, { now: now(), olderThanMs: 0 });

  const listed = await listOfflineSales(scope, { statuses: ["PENDING"] });
  if (!listed.ok) return result;

  for (const candidate of listed.value) {
    const claimed = await claimSaleForSync(scope, candidate.localId, {
      now: now(),
      ignoreBackoff: deps.ignoreBackoff,
    });
    if (!claimed.ok) {
      // Not due yet (backoff) or claimed elsewhere: leave it alone.
      result.outcomes.push({ localId: candidate.localId, outcome: "SKIPPED", reason: claimed.code });
      continue;
    }
    result.attempted += 1;
    const sale = claimed.value;

    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchFn(COUNTER_SYNC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCounterSyncPayload(sale)),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const failure = await markSaleSyncFailure(
        scope,
        sale.localId,
        {
          code: aborted ? "TIMEOUT" : "NETWORK_ERROR",
          message: aborted
            ? "Le serveur n'a pas répondu à temps."
            : "Connexion impossible : la vente sera renvoyée automatiquement.",
          retryable: true,
        },
        { now: now() },
      );
      result.retryLater += 1;
      result.outcomes.push({
        localId: sale.localId,
        outcome: "RETRY_LATER",
        code: aborted ? "TIMEOUT" : "NETWORK_ERROR",
        message: "Connexion interrompue.",
        retryAt: failure.ok ? failure.value.retryAt : null,
      });
      result.status = "STOPPED_NETWORK";
      return result;
    }
    clearTimeout(timer);

    let body: ServerBody | null = null;
    try {
      body = (await response.json()) as ServerBody;
    } catch {
      body = null; // HTML error page, empty body...
    }

    // ---- confirmed by the server: the only road to SYNCED ----
    if (
      response.ok &&
      body?.success === true &&
      typeof body.serverSaleId === "string" &&
      body.serverSaleId !== "" &&
      typeof body.officialDisplayNumber === "string" &&
      body.officialDisplayNumber !== ""
    ) {
      const marked = await markSaleSynced(
        scope,
        sale.localId,
        {
          serverSaleId: body.serverSaleId,
          officialDisplayNumber: body.officialDisplayNumber,
          serverTotalTTC: typeof body.serverTotalTTC === "number" ? body.serverTotalTTC : null,
          totalMismatch: body.totalMismatch === true,
        },
        { now: now() },
      );
      if (marked.ok) {
        result.synced += 1;
        result.outcomes.push({
          localId: sale.localId,
          outcome: "SYNCED",
          officialDisplayNumber: body.officialDisplayNumber,
          duplicate: body.result === "ALREADY_SYNCED",
          totalMismatch: body.totalMismatch === true,
        });
      } else {
        // Confirmed by the server but not recorded here: the row stays
        // SYNCING, is recovered at the next run, and the replay answers
        // ALREADY_SYNCED. Nothing is lost, nothing duplicated.
        result.outcomes.push({ localId: sale.localId, outcome: "SKIPPED", reason: "LOCAL_WRITE_FAILED" });
      }
      continue;
    }

    // ---- session expired: pause, do not burn an attempt, do not loop ----
    const code = typeof body?.code === "string" ? body.code : null;
    if (response.status === 401 || code === "AUTH_REQUIRED") {
      await revertSaleToPending(scope, sale.localId, { now: now() });
      result.outcomes.push({ localId: sale.localId, outcome: "AUTH_PAUSED" });
      result.status = "PAUSED_AUTH";
      return result;
    }

    // ---- a failed attempt ----
    const serverSide =
      response.status >= 500 || response.status === 408 || response.status === 429 || response.status === 404;
    const retryable = typeof body?.retryable === "boolean" ? body.retryable : serverSide || code === null;
    const failureCode = code ?? (response.ok ? "INVALID_SERVER_RESPONSE" : `HTTP_${response.status}`);
    const message =
      typeof body?.message === "string" && body.message
        ? body.message
        : response.ok
          ? "Réponse du serveur illisible : la vente n'est pas confirmée."
          : `Erreur serveur (${response.status}).`;

    const failure = await markSaleSyncFailure(
      scope,
      sale.localId,
      { code: failureCode, message, retryable, httpStatus: response.status },
      { now: now() },
    );
    const retryAt = failure.ok ? failure.value.retryAt : null;
    if (retryAt) {
      result.retryLater += 1;
      result.outcomes.push({ localId: sale.localId, outcome: "RETRY_LATER", code: failureCode, message, retryAt });
    } else {
      result.failed += 1;
      result.outcomes.push({ localId: sale.localId, outcome: "FAILED", code: failureCode, message });
    }
    if (retryable && (serverSide || code === null)) {
      result.status = "STOPPED_SERVER";
      return result;
    }
  }

  result.status = result.attempted === 0 ? "NOTHING_TO_SYNC" : "DONE";
  return result;
}
