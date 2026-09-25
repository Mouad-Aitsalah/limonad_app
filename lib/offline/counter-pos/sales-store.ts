"use client";

/**
 * COUNTER POS - offline sales, carts and the sale state machine.
 *
 * STORAGE ONLY. Nothing here talks to the server and nothing is wired into
 * the POS yet. It records what a future offline "Valider" would need to keep
 * (sale + lines + payments + idempotencyKey, atomically) and the bookkeeping
 * a future sync engine will need (status, attempts, backoff, last error).
 *
 * STATE MACHINE
 *
 *   createOfflineSale ──▶ PENDING ──claimSaleForSync──▶ SYNCING
 *                           ▲  ▲                          │
 *                           │  └──markSaleSyncFailure─────┤ retryable, budget left
 *                           │     (nextAttemptAt = backoff)│
 *   revertSaleToPending ────┘◀─────────────────────────────┤ (auth pause: not an attempt)
 *   reapStaleSyncingSales ──┘                              │
 *                                                          ├──markSaleSynced──▶ SYNCED
 *   requeueFailedSale ─▶ PENDING ◀─ FAILED ◀───────────────┘ permanent, or budget exhausted
 *
 * Every function fails SOFT (a StoreResult) and is scoped to (organization,
 * user): a sale of another user - or another organization - is invisible to
 * it (reported as NOT_FOUND, so its existence is not even confirmed).
 *
 * Deliberately different from the driver layer's sales-store.ts: the local
 * reference comes from a PERSISTED per-device counter (the driver's is a rank
 * computed at read time, so two devices - or a deleted sale - can yield the
 * same OFF- number), and a duplicate idempotencyKey is detected instead of
 * silently inserting a second row.
 */

import { addMoney, roundMoney, subtractMoney } from "@/lib/money";

import {
  assertScope,
  CounterPosStoreError,
  generateUuid,
  getOrCreateDeviceId,
  runStorage,
  toIso,
  type CounterPosDatabase,
} from "./database";
import {
  DEFAULT_CART_SLOT,
  OFFLINE_SALE_STATUSES,
  type CartRecord,
  type CounterPosScope,
  type OfflinePaymentInstrument,
  type OfflinePaymentMethod,
  type OfflineSaleLineRecord,
  type OfflineSalePaymentRecord,
  type OfflineSaleRecord,
  type OfflineSaleStatus,
  type OfflineSaleWithDetails,
  type StoreResult,
  type StoredCartLine,
  type SyncErrorRecord,
} from "./schema";

// ---------------------------------------------------------------------------
// Retry policy (pure, exported for the future sync engine and for tests)
// ---------------------------------------------------------------------------

/** After this many attempts a retryable failure becomes FAILED (no endless loop). */
export const SYNC_MAX_ATTEMPTS = 8;
export const SYNC_RETRY_BASE_DELAY_MS = 5_000;
export const SYNC_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
/** A SYNCING row older than this is presumed interrupted (the request timeout
 *  the engine will use is far shorter). */
export const SYNC_STALE_LOCK_MS = 2 * 60 * 1000;

/** Delay before the next automatic attempt, given how many attempts were
 *  ALREADY made (1 -> 5 s, 2 -> 10 s, 3 -> 20 s ... capped at 1 h). */
export function computeRetryDelayMs(attemptsMade: number): number {
  const exponent = Math.max(0, Math.min(30, Math.trunc(attemptsMade) - 1));
  return Math.min(SYNC_RETRY_MAX_DELAY_MS, SYNC_RETRY_BASE_DELAY_MS * 2 ** exponent);
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type OfflineSaleLineInput = {
  productId: string;
  productReference: string;
  productName: string;
  quantity: number;
  unitPriceHT: number;
  taxRate: number;
  /** DH taken off the unit's TTC price (lib/pos-discount.ts). */
  discountUnitAmount: number;
  priceOverridden?: boolean;
  discountAmount: number;
  totalHT: number;
  taxAmount: number;
  totalTTC: number;
};

export type OfflineSalePaymentInput = {
  method: OfflinePaymentInstrument;
  amount: number;
  reference?: string | null;
};

export type OfflineSaleInput = {
  depotId?: string | null;
  stockLocationId: string;
  customer: { id: string; code: string | null; name: string } | null;
  paymentMethod: OfflinePaymentMethod;
  reference?: string | null;
  bankAccountingAccountId?: string | null;
  lines: OfflineSaleLineInput[];
  payments: OfflineSalePaymentInput[];
  totals: {
    subtotalHT: number;
    discountAmount: number;
    taxAmount: number;
    totalTTC: number;
    paidAmount: number;
    creditAmount: number;
  };
  /** Generated when omitted. Provide the cart's persisted key to keep one
   *  logical sale on one key across a reload. Max 120 chars (server bound). */
  idempotencyKey?: string;
  reservedSaleNumber?: number | null;
  reservedSaleYear?: number | null;
  /** ISO time of the sale. Defaults to now. */
  soldAt?: string;
  /** Delete this cart slot in the SAME transaction, so a crash can never leave
   *  a saved sale AND its cart (which a reload would re-submit). */
  clearCartSlot?: string | null;
};

const PAYMENT_METHODS: readonly OfflinePaymentMethod[] = [
  "CASH",
  "CHECK",
  "BANK_TRANSFER",
  "CREDIT",
  "MIXED",
];
const PAYMENT_INSTRUMENTS: readonly OfflinePaymentInstrument[] = ["CASH", "CHECK", "BANK_TRANSFER"];
const MAX_IDEMPOTENCY_KEY_LENGTH = 120;
const MAX_QUANTITY = 1_000_000;
const MONEY_TOLERANCE = 0.01;

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sameMoney(a: number, b: number): boolean {
  return Math.abs(subtractMoney(a, b)) <= MONEY_TOLERANCE;
}

function sumMoney(values: number[]): number {
  return addMoney(...values);
}

/**
 * Structural and arithmetic integrity only - the guard against saving a sale
 * whose own numbers contradict each other. It does NOT re-implement business
 * rules (credit ceiling, customer required, stock, price): the server stays
 * the authority on those when the sale is sent.
 */
export function validateOfflineSaleInput(input: OfflineSaleInput): string[] {
  const issues: string[] = [];
  if (!input || typeof input !== "object") return ["Vente invalide."];

  if (typeof input.stockLocationId !== "string" || input.stockLocationId.trim() === "") {
    issues.push("stockLocationId est requis.");
  }
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) issues.push("Mode de paiement invalide.");

  if (
    input.idempotencyKey !== undefined &&
    (typeof input.idempotencyKey !== "string" ||
      input.idempotencyKey.trim() === "" ||
      input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH)
  ) {
    issues.push(`idempotencyKey doit contenir 1 a ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres.`);
  }

  const hasNumber = input.reservedSaleNumber != null;
  const hasYear = input.reservedSaleYear != null;
  if (hasNumber !== hasYear) {
    issues.push("reservedSaleNumber et reservedSaleYear vont ensemble.");
  } else if (
    hasNumber &&
    (!Number.isInteger(input.reservedSaleNumber) ||
      (input.reservedSaleNumber as number) <= 0 ||
      !Number.isInteger(input.reservedSaleYear) ||
      (input.reservedSaleYear as number) <= 0)
  ) {
    issues.push("Numero reserve invalide.");
  }

  if (input.soldAt !== undefined && Number.isNaN(new Date(input.soldAt).getTime())) {
    issues.push("soldAt n'est pas une date valide.");
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    issues.push("La vente doit contenir au moins une ligne.");
    return issues;
  }

  const seen = new Set<string>();
  for (const [index, line] of input.lines.entries()) {
    const label = `Ligne ${index + 1}`;
    if (typeof line.productId !== "string" || line.productId.trim() === "") {
      issues.push(`${label}: productId est requis.`);
    } else if (seen.has(line.productId)) {
      issues.push(`${label}: un produit ne peut apparaitre qu'une fois.`);
    } else {
      seen.add(line.productId);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > MAX_QUANTITY) {
      issues.push(`${label}: quantite invalide.`);
    }
    if (!isMoney(line.unitPriceHT)) issues.push(`${label}: prix unitaire invalide.`);
    if (
      typeof line.taxRate !== "number" ||
      !Number.isFinite(line.taxRate) ||
      line.taxRate < 0 ||
      line.taxRate > 100
    ) {
      issues.push(`${label}: taux de TVA invalide.`);
    }
    for (const [field, value] of [
      ["remise", line.discountUnitAmount],
      ["montant de remise", line.discountAmount],
      ["total HT", line.totalHT],
      ["TVA", line.taxAmount],
      ["total TTC", line.totalTTC],
    ] as const) {
      if (!isMoney(value)) issues.push(`${label}: ${field} invalide.`);
    }
    if (
      isMoney(line.totalHT) &&
      isMoney(line.taxAmount) &&
      isMoney(line.totalTTC) &&
      !sameMoney(addMoney(line.totalHT, line.taxAmount), line.totalTTC)
    ) {
      issues.push(`${label}: HT + TVA ne correspond pas au TTC.`);
    }
  }

  const totals = input.totals;
  if (!totals || typeof totals !== "object") {
    issues.push("Totaux manquants.");
    return issues;
  }
  const totalsOk = (
    ["subtotalHT", "discountAmount", "taxAmount", "totalTTC", "paidAmount", "creditAmount"] as const
  ).every((key) => {
    const valid = isMoney(totals[key]);
    if (!valid) issues.push(`Total invalide: ${key}.`);
    return valid;
  });
  if (!totalsOk || issues.length > 0) return issues;

  if (!sameMoney(sumMoney(input.lines.map((l) => l.totalHT)), totals.subtotalHT)) {
    issues.push("Le sous-total HT ne correspond pas aux lignes.");
  }
  if (!sameMoney(sumMoney(input.lines.map((l) => l.taxAmount)), totals.taxAmount)) {
    issues.push("La TVA ne correspond pas aux lignes.");
  }
  if (!sameMoney(sumMoney(input.lines.map((l) => l.discountAmount)), totals.discountAmount)) {
    issues.push("La remise ne correspond pas aux lignes.");
  }
  if (!sameMoney(addMoney(totals.subtotalHT, totals.taxAmount), totals.totalTTC)) {
    issues.push("Le total TTC ne correspond pas a HT + TVA.");
  }
  if (!sameMoney(addMoney(totals.paidAmount, totals.creditAmount), totals.totalTTC)) {
    issues.push("Paye + credit ne correspond pas au total TTC.");
  }

  if (!Array.isArray(input.payments)) {
    issues.push("Paiements invalides.");
  } else {
    for (const [index, payment] of input.payments.entries()) {
      if (!PAYMENT_INSTRUMENTS.includes(payment.method)) {
        issues.push(`Paiement ${index + 1}: mode invalide.`);
      }
      if (!isMoney(payment.amount) || payment.amount <= 0) {
        issues.push(`Paiement ${index + 1}: montant invalide.`);
      }
    }
    if (
      issues.length === 0 &&
      !sameMoney(sumMoney(input.payments.map((p) => p.amount)), totals.paidAmount)
    ) {
      issues.push("La somme des paiements ne correspond pas au montant paye.");
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function attachDetails(
  db: CounterPosDatabase,
  sale: OfflineSaleRecord,
): Promise<OfflineSaleWithDetails> {
  const [lines, payments] = await Promise.all([
    db.offlineSaleLines.where("localId").equals(sale.localId).sortBy("position"),
    db.offlineSalePayments.where("localId").equals(sale.localId).sortBy("position"),
  ]);
  return { ...sale, lines, payments };
}

/** The sale, only if it belongs to this scope. Another user's or organization's
 *  sale is treated as absent: its existence is not confirmed. */
async function getScopedSale(
  db: CounterPosDatabase,
  scope: CounterPosScope,
  localId: string,
): Promise<OfflineSaleRecord | null> {
  if (typeof localId !== "string" || localId === "") return null;
  const sale = await db.offlineSales.get(localId);
  if (!sale) return null;
  if (sale.organizationId !== scope.organizationId || sale.userId !== scope.userId) return null;
  return sale;
}

async function requireScopedSale(
  db: CounterPosDatabase,
  scope: CounterPosScope,
  localId: string,
): Promise<OfflineSaleRecord> {
  const sale = await getScopedSale(db, scope, localId);
  if (!sale) throw new CounterPosStoreError("NOT_FOUND", "Vente locale introuvable.");
  return sale;
}

function formatLocalDay(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/** "OFF-<device 6>-<YYYYMMDD>-<NNNN>" from a counter persisted in `meta`, so it
 *  never repeats on this device even if sales are deleted or pruned. Display
 *  only - never an invoice number and never an identity (localId is). */
async function nextLocalReference(
  db: CounterPosDatabase,
  deviceId: string,
  soldAtIso: string,
): Promise<string> {
  const day = formatLocalDay(soldAtIso);
  const key = `localSeq:${day}`;
  const current = await db.meta.get(key);
  const next = (typeof current?.value === "number" ? current.value : 0) + 1;
  await db.meta.put({ key, value: next });
  const deviceShort = deviceId.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `OFF-${deviceShort}-${day}-${String(next).padStart(4, "0")}`;
}

function sameSaleContent(existing: OfflineSaleWithDetails, input: OfflineSaleInput): boolean {
  if (!sameMoney(existing.totalTTC, input.totals.totalTTC)) return false;
  if (existing.lines.length !== input.lines.length) return false;
  const existingByProduct = new Map(existing.lines.map((l) => [l.productId, l.quantity]));
  return input.lines.every((l) => existingByProduct.get(l.productId) === l.quantity);
}

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------

/**
 * Saves one offline sale - the sale row, its lines and its payments (and
 * optionally deletes the cart it came from) - in ONE atomic IndexedDB
 * transaction: either everything is written or nothing is.
 *
 * Idempotent on `idempotencyKey`: calling it again with the same key and the
 * same content returns the ALREADY-saved sale (`created: false`) instead of
 * writing a second one - the local twin of createCounterSale's own check. The
 * same key with DIFFERENT content, or a key owned by another user, is refused
 * (DUPLICATE_IDEMPOTENCY_KEY): a key must identify exactly one logical sale.
 *
 * The sale starts PENDING with 0 attempts. This does not decrement any stock
 * (the stock snapshot is a server value; see pos-data-source.ts).
 */
export function createOfflineSale(
  scope: CounterPosScope,
  input: OfflineSaleInput,
  options: { now?: Date } = {},
): Promise<StoreResult<{ sale: OfflineSaleWithDetails; created: boolean }>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const issues = validateOfflineSaleInput(input);
    if (issues.length > 0) throw new CounterPosStoreError("INVALID_INPUT", issues.join(" "));

    const nowIso = toIso(options.now);
    const soldAt = input.soldAt ?? nowIso;
    const idempotencyKey = input.idempotencyKey ?? generateUuid();

    return db.transaction(
      "rw",
      [db.meta, db.offlineSales, db.offlineSaleLines, db.offlineSalePayments, db.carts],
      async () => {
        const existing = await db.offlineSales.where("idempotencyKey").equals(idempotencyKey).first();
        if (existing) {
          if (existing.organizationId !== scope.organizationId || existing.userId !== scope.userId) {
            throw new CounterPosStoreError(
              "DUPLICATE_IDEMPOTENCY_KEY",
              "Cette cle d'idempotence appartient a une autre vente.",
            );
          }
          const details = await attachDetails(db, existing);
          if (!sameSaleContent(details, input)) {
            throw new CounterPosStoreError(
              "DUPLICATE_IDEMPOTENCY_KEY",
              "Cette cle d'idempotence est deja utilisee par une vente differente.",
            );
          }
          return { sale: details, created: false };
        }

        const deviceId = await getOrCreateDeviceId(db);
        const localId = generateUuid();
        const sale: OfflineSaleRecord = {
          localId,
          organizationId: scope.organizationId,
          userId: scope.userId,
          deviceId,
          depotId: input.depotId ?? null,
          stockLocationId: input.stockLocationId,
          customerId: input.customer?.id ?? null,
          customerCode: input.customer?.code ?? null,
          customerName: input.customer?.name ?? null,
          paymentMethod: input.paymentMethod,
          reference: input.reference ?? null,
          bankAccountingAccountId: input.bankAccountingAccountId ?? null,
          subtotalHT: roundMoney(input.totals.subtotalHT),
          discountAmount: roundMoney(input.totals.discountAmount),
          taxAmount: roundMoney(input.totals.taxAmount),
          totalTTC: roundMoney(input.totals.totalTTC),
          paidAmount: roundMoney(input.totals.paidAmount),
          creditAmount: roundMoney(input.totals.creditAmount),
          idempotencyKey,
          reservedSaleNumber: input.reservedSaleNumber ?? null,
          reservedSaleYear: input.reservedSaleYear ?? null,
          localReference: await nextLocalReference(db, deviceId, soldAt),
          soldAt,
          createdAtLocal: nowIso,
          updatedAtLocal: nowIso,
          status: "PENDING",
          syncAttempts: 0,
          lastAttemptAt: null,
          nextAttemptAt: null,
          lockedAt: null,
          lastError: null,
          serverSaleId: null,
          officialDisplayNumber: null,
          syncedAt: null,
          serverTotalTTC: null,
          totalMismatch: false,
        };
        const lines: OfflineSaleLineRecord[] = input.lines.map((line, position) => ({
          id: generateUuid(),
          localId,
          organizationId: scope.organizationId,
          position,
          productId: line.productId,
          productReference: line.productReference,
          productName: line.productName,
          quantity: line.quantity,
          unitPriceHT: line.unitPriceHT,
          taxRate: line.taxRate,
          discountUnitAmount: line.discountUnitAmount,
          priceOverridden: line.priceOverridden === true,
          discountAmount: line.discountAmount,
          totalHT: line.totalHT,
          taxAmount: line.taxAmount,
          totalTTC: line.totalTTC,
        }));
        const payments: OfflineSalePaymentRecord[] = input.payments.map((payment, position) => ({
          id: generateUuid(),
          localId,
          organizationId: scope.organizationId,
          position,
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference ?? null,
        }));

        await db.offlineSales.add(sale);
        await db.offlineSaleLines.bulkAdd(lines);
        if (payments.length > 0) await db.offlineSalePayments.bulkAdd(payments);
        if (input.clearCartSlot) {
          await db.carts.delete([scope.organizationId, scope.userId, input.clearCartSlot]);
        }
        return { sale: { ...sale, lines, payments }, created: true };
      },
    );
  });
}

export function getOfflineSale(
  scope: CounterPosScope,
  localId: string,
): Promise<StoreResult<OfflineSaleWithDetails>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    return attachDetails(db, await requireScopedSale(db, scope, localId));
  });
}

export function findOfflineSaleByIdempotencyKey(
  scope: CounterPosScope,
  idempotencyKey: string,
): Promise<StoreResult<OfflineSaleWithDetails | null>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const sale = await db.offlineSales.where("idempotencyKey").equals(idempotencyKey).first();
    if (!sale || sale.organizationId !== scope.organizationId || sale.userId !== scope.userId) {
      return null;
    }
    return attachDetails(db, sale);
  });
}

/** This user's sales, oldest first (soldAt, then creation) - the order a sync
 *  engine must send them in. Optionally restricted to some statuses. */
export function listOfflineSales(
  scope: CounterPosScope,
  options: { statuses?: readonly OfflineSaleStatus[] } = {},
): Promise<StoreResult<OfflineSaleWithDetails[]>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const statuses = options.statuses ?? OFFLINE_SALE_STATUSES;
    const rows = await db.offlineSales
      .where("[organizationId+userId+status]")
      .anyOf(statuses.map((status) => [scope.organizationId, scope.userId, status]))
      .toArray();
    rows.sort(
      (a, b) =>
        a.soldAt.localeCompare(b.soldAt) || a.createdAtLocal.localeCompare(b.createdAtLocal),
    );
    return Promise.all(rows.map((sale) => attachDetails(db, sale)));
  });
}

export function countOfflineSalesByStatus(
  scope: CounterPosScope,
): Promise<StoreResult<Record<OfflineSaleStatus, number>>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const counts: Record<OfflineSaleStatus, number> = { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0 };
    for (const status of OFFLINE_SALE_STATUSES) {
      counts[status] = await db.offlineSales
        .where("[organizationId+userId+status]")
        .equals([scope.organizationId, scope.userId, status])
        .count();
    }
    return counts;
  });
}

/**
 * Quantity per product that sales of THIS stock location (every user of the
 * depot on this PC) have taken but the server has not applied yet: PENDING and
 * SYNCING. The stock snapshot is a server value that does not include them, so
 * `displayed = snapshot - pending` (see pos-data-source.ts).
 *
 * FAILED sales are excluded: the server refused them, so they never moved
 * stock. A SYNCING sale the server already applied but whose reply was not
 * yet processed is counted twice for a moment - it corrects itself on the
 * next snapshot refresh after it becomes SYNCED.
 */
export function getPendingQuantityByProduct(
  organizationId: string,
  stockLocationId: string,
): Promise<StoreResult<Record<string, number>>> {
  return runStorage(organizationId, async (db) => {
    const sales = await db.offlineSales
      .where("[organizationId+stockLocationId+status]")
      .anyOf([
        [organizationId, stockLocationId, "PENDING"],
        [organizationId, stockLocationId, "SYNCING"],
      ])
      .toArray();
    if (sales.length === 0) return {};
    const lines = await db.offlineSaleLines
      .where("localId")
      .anyOf(sales.map((sale) => sale.localId))
      .toArray();
    const totals: Record<string, number> = {};
    for (const line of lines) totals[line.productId] = (totals[line.productId] ?? 0) + line.quantity;
    return totals;
  });
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

type TransitionOptions = { now?: Date };

/** PENDING -> SYNCING. Refuses a sale that is not PENDING or whose backoff has
 *  not elapsed, so two engines (or two tabs) can never send the same sale. */
export function claimSaleForSync(
  scope: CounterPosScope,
  localId: string,
  options: TransitionOptions & { ignoreBackoff?: boolean } = {},
): Promise<StoreResult<OfflineSaleWithDetails>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const nowIso = toIso(options.now);
    return db.transaction("rw", [db.offlineSales, db.offlineSaleLines, db.offlineSalePayments], async () => {
      const sale = await requireScopedSale(db, scope, localId);
      if (sale.status !== "PENDING") {
        throw new CounterPosStoreError(
          "INVALID_TRANSITION",
          `Une vente ${sale.status} ne peut pas etre envoyee.`,
        );
      }
      if (!options.ignoreBackoff && sale.nextAttemptAt && sale.nextAttemptAt > nowIso) {
        throw new CounterPosStoreError("INVALID_TRANSITION", "Le prochain essai n'est pas encore du.");
      }
      const updated: OfflineSaleRecord = {
        ...sale,
        status: "SYNCING",
        lockedAt: nowIso,
        lastAttemptAt: nowIso,
        syncAttempts: sale.syncAttempts + 1,
        updatedAtLocal: nowIso,
      };
      await db.offlineSales.put(updated);
      return attachDetails(db, updated);
    });
  });
}

export type SyncSuccess = {
  serverSaleId: string;
  officialDisplayNumber: string;
  serverTotalTTC?: number | null;
  totalMismatch?: boolean;
};

/** -> SYNCED, from ANY non-SYNCED status: a server confirmation is the truth,
 *  even if a restart already put the row back to PENDING meanwhile. Confirming
 *  an already SYNCED sale is a no-op that keeps the first confirmation. */
export function markSaleSynced(
  scope: CounterPosScope,
  localId: string,
  result: SyncSuccess,
  options: TransitionOptions = {},
): Promise<StoreResult<OfflineSaleWithDetails>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    if (
      !result ||
      typeof result.serverSaleId !== "string" ||
      result.serverSaleId === "" ||
      typeof result.officialDisplayNumber !== "string" ||
      result.officialDisplayNumber === ""
    ) {
      throw new CounterPosStoreError(
        "INVALID_INPUT",
        "serverSaleId et officialDisplayNumber sont requis.",
      );
    }
    const nowIso = toIso(options.now);
    return db.transaction("rw", [db.offlineSales, db.offlineSaleLines, db.offlineSalePayments], async () => {
      const sale = await requireScopedSale(db, scope, localId);
      if (sale.status === "SYNCED") return attachDetails(db, sale);
      const updated: OfflineSaleRecord = {
        ...sale,
        status: "SYNCED",
        serverSaleId: result.serverSaleId,
        officialDisplayNumber: result.officialDisplayNumber,
        serverTotalTTC: result.serverTotalTTC ?? null,
        totalMismatch: result.totalMismatch === true,
        syncedAt: nowIso,
        lockedAt: null,
        nextAttemptAt: null,
        lastError: null,
        updatedAtLocal: nowIso,
      };
      await db.offlineSales.put(updated);
      return attachDetails(db, updated);
    });
  });
}

export type SyncFailureInput = {
  code: string;
  message: string;
  retryable: boolean;
  httpStatus?: number | null;
};

export type SyncFailureOutcome = {
  sale: OfflineSaleWithDetails;
  /** ISO time of the next automatic attempt, or null when the sale is FAILED. */
  retryAt: string | null;
};

/**
 * Records a failed attempt (SYNCING -> PENDING or FAILED):
 *  - not retryable                       -> FAILED (permanent rejection)
 *  - retryable, budget left              -> PENDING with nextAttemptAt (backoff)
 *  - retryable, attempts >= maxAttempts  -> FAILED (no endless loop)
 */
export function markSaleSyncFailure(
  scope: CounterPosScope,
  localId: string,
  failure: SyncFailureInput,
  options: TransitionOptions & { maxAttempts?: number } = {},
): Promise<StoreResult<SyncFailureOutcome>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const now = options.now ?? new Date();
    const nowIso = toIso(now);
    const maxAttempts = options.maxAttempts ?? SYNC_MAX_ATTEMPTS;
    return db.transaction("rw", [db.offlineSales, db.offlineSaleLines, db.offlineSalePayments], async () => {
      const sale = await requireScopedSale(db, scope, localId);
      if (sale.status !== "SYNCING") {
        throw new CounterPosStoreError(
          "INVALID_TRANSITION",
          `Un echec ne peut etre enregistre que pour une vente SYNCING (etat: ${sale.status}).`,
        );
      }
      const lastError: SyncErrorRecord = {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        httpStatus: failure.httpStatus ?? null,
        at: nowIso,
      };
      const giveUp = !failure.retryable || sale.syncAttempts >= maxAttempts;
      const retryAt = giveUp
        ? null
        : toIso(new Date(now.getTime() + computeRetryDelayMs(sale.syncAttempts)));
      const updated: OfflineSaleRecord = {
        ...sale,
        status: giveUp ? "FAILED" : "PENDING",
        nextAttemptAt: retryAt,
        lockedAt: null,
        lastError,
        updatedAtLocal: nowIso,
      };
      await db.offlineSales.put(updated);
      return { sale: await attachDetails(db, updated), retryAt };
    });
  });
}

/** SYNCING -> PENDING WITHOUT counting the attempt: for a pause that is not the
 *  sale's fault (expired session, engine stopped). */
export function revertSaleToPending(
  scope: CounterPosScope,
  localId: string,
  options: TransitionOptions = {},
): Promise<StoreResult<OfflineSaleWithDetails>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const nowIso = toIso(options.now);
    return db.transaction("rw", [db.offlineSales, db.offlineSaleLines, db.offlineSalePayments], async () => {
      const sale = await requireScopedSale(db, scope, localId);
      if (sale.status !== "SYNCING") {
        throw new CounterPosStoreError(
          "INVALID_TRANSITION",
          `Seule une vente SYNCING peut etre remise en attente (etat: ${sale.status}).`,
        );
      }
      const updated: OfflineSaleRecord = {
        ...sale,
        status: "PENDING",
        syncAttempts: Math.max(0, sale.syncAttempts - 1),
        lockedAt: null,
        updatedAtLocal: nowIso,
      };
      await db.offlineSales.put(updated);
      return attachDetails(db, updated);
    });
  });
}

/** FAILED -> PENDING by explicit user action, with a fresh retry budget. The
 *  previous error is kept until the next attempt overwrites it. */
export function requeueFailedSale(
  scope: CounterPosScope,
  localId: string,
  options: TransitionOptions = {},
): Promise<StoreResult<OfflineSaleWithDetails>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const nowIso = toIso(options.now);
    return db.transaction("rw", [db.offlineSales, db.offlineSaleLines, db.offlineSalePayments], async () => {
      const sale = await requireScopedSale(db, scope, localId);
      if (sale.status !== "FAILED") {
        throw new CounterPosStoreError(
          "INVALID_TRANSITION",
          `Seule une vente FAILED peut etre relancee (etat: ${sale.status}).`,
        );
      }
      const updated: OfflineSaleRecord = {
        ...sale,
        status: "PENDING",
        syncAttempts: 0,
        nextAttemptAt: null,
        lockedAt: null,
        updatedAtLocal: nowIso,
      };
      await db.offlineSales.put(updated);
      return attachDetails(db, updated);
    });
  });
}

/**
 * Crash / restart recovery: a SYNCING sale whose lock is older than
 * `olderThanMs` (or has no lock) was interrupted - put it back to PENDING so
 * it is retried with the SAME idempotencyKey, which is what makes the retry
 * safe even if the server had already created the sale. Returns how many.
 */
export function reapStaleSyncingSales(
  scope: CounterPosScope,
  options: TransitionOptions & { olderThanMs?: number } = {},
): Promise<StoreResult<number>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const now = options.now ?? new Date();
    const nowIso = toIso(now);
    const threshold = now.getTime() - (options.olderThanMs ?? SYNC_STALE_LOCK_MS);
    return db.transaction("rw", db.offlineSales, async () => {
      const syncing = await db.offlineSales
        .where("[organizationId+userId+status]")
        .equals([scope.organizationId, scope.userId, "SYNCING"])
        .toArray();
      let reaped = 0;
      for (const sale of syncing) {
        const lockedMs = sale.lockedAt ? new Date(sale.lockedAt).getTime() : Number.NEGATIVE_INFINITY;
        if (lockedMs > threshold) continue;
        await db.offlineSales.put({
          ...sale,
          status: "PENDING",
          lockedAt: null,
          updatedAtLocal: nowIso,
        });
        reaped += 1;
      }
      return reaped;
    });
  });
}

/** Deletes SYNCED sales (with their lines and payments) confirmed longer ago
 *  than `olderThanMs`. Nothing else is ever pruned. Returns how many. */
export function pruneSyncedSales(
  scope: CounterPosScope,
  options: TransitionOptions & { olderThanMs: number },
): Promise<StoreResult<number>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const threshold = (options.now ?? new Date()).getTime() - options.olderThanMs;
    return db.transaction(
      "rw",
      [db.offlineSales, db.offlineSaleLines, db.offlineSalePayments],
      async () => {
        const synced = await db.offlineSales
          .where("[organizationId+userId+status]")
          .equals([scope.organizationId, scope.userId, "SYNCED"])
          .toArray();
        const stale = synced.filter(
          (sale) => sale.syncedAt !== null && new Date(sale.syncedAt).getTime() <= threshold,
        );
        for (const sale of stale) {
          await db.offlineSaleLines.where("localId").equals(sale.localId).delete();
          await db.offlineSalePayments.where("localId").equals(sale.localId).delete();
          await db.offlineSales.delete(sale.localId);
        }
        return stale.length;
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Cart persistence
// ---------------------------------------------------------------------------

export type CartInput = {
  slot?: string;
  lines: StoredCartLine[];
  customerId: string | null;
  paymentMethod: OfflinePaymentMethod;
  chequeNumber: string;
  banque: string;
  bankAccountId: string;
  mixedCash: number;
  mixedCheque: number;
  idempotencyKey: string;
  reservedSaleNumber: number | null;
  reservedSaleYear: number | null;
};

export function validateCartInput(input: CartInput): string[] {
  const issues: string[] = [];
  if (!input || typeof input !== "object") return ["Panier invalide."];
  if (input.slot !== undefined && (typeof input.slot !== "string" || input.slot.trim() === "")) {
    issues.push("slot invalide.");
  }
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.trim() === "" ||
    input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    issues.push(`idempotencyKey doit contenir 1 a ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres.`);
  }
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) issues.push("Mode de paiement invalide.");
  if (!isMoney(input.mixedCash) || !isMoney(input.mixedCheque)) {
    issues.push("Montants du paiement mixte invalides.");
  }
  if (!Array.isArray(input.lines)) {
    issues.push("Lignes invalides.");
    return issues;
  }
  for (const [index, line] of input.lines.entries()) {
    if (typeof line.productId !== "string" || line.productId === "") {
      issues.push(`Ligne ${index + 1}: productId est requis.`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > MAX_QUANTITY) {
      issues.push(`Ligne ${index + 1}: quantite invalide.`);
    }
    if (!isMoney(line.discountUnitAmount)) issues.push(`Ligne ${index + 1}: remise invalide.`);
    if (line.priceOverrideHT != null && !isMoney(line.priceOverrideHT)) {
      issues.push(`Ligne ${index + 1}: prix manuel invalide.`);
    }
  }
  return issues;
}

/** Upserts this user's cart (one row per slot). `createdAt` is kept across
 *  updates; `idempotencyKey` is whatever the caller persists with it. */
export function saveCart(
  scope: CounterPosScope,
  input: CartInput,
  options: TransitionOptions = {},
): Promise<StoreResult<CartRecord>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    const issues = validateCartInput(input);
    if (issues.length > 0) throw new CounterPosStoreError("INVALID_INPUT", issues.join(" "));
    const nowIso = toIso(options.now);
    const slot = input.slot ?? DEFAULT_CART_SLOT;
    return db.transaction("rw", db.carts, async () => {
      const key: [string, string, string] = [scope.organizationId, scope.userId, slot];
      const previous = await db.carts.get(key);
      const record: CartRecord = {
        organizationId: scope.organizationId,
        userId: scope.userId,
        slot,
        lines: input.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          discountUnitAmount: line.discountUnitAmount,
          priceOverrideHT: line.priceOverrideHT ?? null,
        })),
        customerId: input.customerId,
        paymentMethod: input.paymentMethod,
        chequeNumber: input.chequeNumber,
        banque: input.banque,
        bankAccountId: input.bankAccountId,
        mixedCash: input.mixedCash,
        mixedCheque: input.mixedCheque,
        idempotencyKey: input.idempotencyKey,
        reservedSaleNumber: input.reservedSaleNumber,
        reservedSaleYear: input.reservedSaleYear,
        createdAt: previous?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
      await db.carts.put(record);
      return record;
    });
  });
}

export function loadCart(
  scope: CounterPosScope,
  slot: string = DEFAULT_CART_SLOT,
): Promise<StoreResult<CartRecord | null>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    return (await db.carts.get([scope.organizationId, scope.userId, slot])) ?? null;
  });
}

export function deleteCart(
  scope: CounterPosScope,
  slot: string = DEFAULT_CART_SLOT,
): Promise<StoreResult<void>> {
  return runStorage(scope?.organizationId ?? "", async (db) => {
    assertScope(scope);
    await db.carts.delete([scope.organizationId, scope.userId, slot]);
  });
}
