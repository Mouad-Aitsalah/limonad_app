"use client";

/**
 * COUNTER POS - IndexedDB access (Dexie), one database per organization.
 *
 * Generic concepts reused from lib/offline/driver-pos/database.ts (which is
 * NOT modified and NOT imported): every operation FAILS SOFT (a StoreResult,
 * never a rejection) so a broken or unavailable IndexedDB can never crash
 * the POS; schema changes are versioned; a sale's records are written in ONE
 * atomic transaction.
 *
 * Deliberately NOT carried over: the driver layer's scope is
 * (organizationId, driverId) on SQLite; here isolation is a database per
 * organization plus a userId on everything that carries attribution (see
 * schema.ts).
 */

import Dexie, { type Table } from "dexie";

import {
  COUNTER_POS_DB_PREFIX,
  COUNTER_POS_STORES,
  type AuthorizedUserRecord,
  type CartRecord,
  type CounterPosScope,
  type CustomerRecord,
  type MetaRecord,
  type OfflineSaleLineRecord,
  type OfflineSalePaymentRecord,
  type OfflineSaleRecord,
  type OrganizationInfoRecord,
  type PosContextRecord,
  type ProductRecord,
  type StockLevelRecord,
  type StoreErrorCode,
  type StoreResult,
  type SyncStateRecord,
} from "./schema";

/** Thrown INSIDE a transaction to abort it with a specific, mappable code. */
export class CounterPosStoreError extends Error {
  constructor(
    public readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CounterPosStoreError";
  }
}

export class CounterPosDatabase extends Dexie {
  // `declare` (not `!`): with useDefineForClassFields a plain field would be
  // re-initialised to undefined after Dexie installs its table accessors.
  declare meta: Table<MetaRecord, string>;
  declare authorizedUsers: Table<AuthorizedUserRecord, [string, string]>;
  declare organizationInfo: Table<OrganizationInfoRecord, string>;
  declare posContexts: Table<PosContextRecord, [string, string]>;
  declare products: Table<ProductRecord, [string, string]>;
  declare stockLevels: Table<StockLevelRecord, [string, string, string]>;
  declare customers: Table<CustomerRecord, [string, string]>;
  declare carts: Table<CartRecord, [string, string, string]>;
  declare offlineSales: Table<OfflineSaleRecord, string>;
  declare offlineSaleLines: Table<OfflineSaleLineRecord, string>;
  declare offlineSalePayments: Table<OfflineSalePaymentRecord, string>;
  declare syncStates: Table<SyncStateRecord, [string, string]>;

  constructor(name: string) {
    super(name);
    this.version(1).stores(COUNTER_POS_STORES);
  }
}

export function counterPosDatabaseName(organizationId: string): string {
  return `${COUNTER_POS_DB_PREFIX}:${organizationId}`;
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

const instances = new Map<string, CounterPosDatabase>();

/**
 * The database of ONE organization, or null when the id is unusable or
 * IndexedDB does not exist here (SSR, some private modes). Never throws.
 */
export function getCounterPosDatabase(organizationId: string): CounterPosDatabase | null {
  if (typeof organizationId !== "string" || organizationId.trim() === "") return null;
  if (!isIndexedDbAvailable()) return null;
  let db = instances.get(organizationId);
  if (!db) {
    db = new CounterPosDatabase(counterPosDatabaseName(organizationId));
    instances.set(organizationId, db);
  }
  return db;
}

/** Closes one organization's connection; the next access reopens it. */
export function closeCounterPosDatabase(organizationId: string): void {
  const db = instances.get(organizationId);
  if (!db) return;
  db.close();
  instances.delete(organizationId);
}

export function closeAllCounterPosDatabases(): void {
  for (const organizationId of [...instances.keys()]) closeCounterPosDatabase(organizationId);
}

/** Deletes an organization's whole local database (e.g. an explicit wipe on a
 *  shared PC). Irreversible: unsynced sales in it are lost. */
export async function deleteCounterPosDatabase(organizationId: string): Promise<StoreResult<void>> {
  if (typeof organizationId !== "string" || organizationId.trim() === "") {
    return { ok: false, code: "INVALID_INPUT", message: "organizationId is required." };
  }
  if (!isIndexedDbAvailable()) {
    return { ok: false, code: "INDEXEDDB_UNAVAILABLE", message: "IndexedDB is not available." };
  }
  try {
    closeCounterPosDatabase(organizationId);
    await Dexie.delete(counterPosDatabaseName(organizationId));
    return { ok: true, value: undefined };
  } catch (error) {
    return toStoreFailure(error);
  }
}

export function toStoreFailure(error: unknown): { ok: false; code: StoreErrorCode; message: string } {
  if (error instanceof CounterPosStoreError) {
    return { ok: false, code: error.code, message: error.message };
  }
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "QuotaExceededError" || /quota/i.test(message)) {
    return { ok: false, code: "QUOTA_EXCEEDED", message: "Local storage is full." };
  }
  console.error("[COUNTER POS STORE] unexpected storage error", error);
  return { ok: false, code: "STORAGE_ERROR", message };
}

/**
 * Runs `fn` against an organization's database and folds every outcome into a
 * StoreResult. This is the ONLY door the stores use to touch IndexedDB.
 */
export async function runStorage<T>(
  organizationId: string,
  fn: (db: CounterPosDatabase) => Promise<T>,
): Promise<StoreResult<T>> {
  if (!isIndexedDbAvailable()) {
    return { ok: false, code: "INDEXEDDB_UNAVAILABLE", message: "IndexedDB is not available." };
  }
  const db = getCounterPosDatabase(organizationId);
  if (!db) {
    return { ok: false, code: "INVALID_INPUT", message: "organizationId is required." };
  }
  try {
    return { ok: true, value: await fn(db) };
  } catch (error) {
    return toStoreFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Scope guards
// ---------------------------------------------------------------------------

export function assertScope(scope: CounterPosScope): void {
  if (
    !scope ||
    typeof scope.organizationId !== "string" ||
    scope.organizationId.trim() === "" ||
    typeof scope.userId !== "string" ||
    scope.userId.trim() === ""
  ) {
    throw new CounterPosStoreError("INVALID_INPUT", "organizationId and userId are required.");
  }
}

/** A record read from (or about to be written to) storage must belong to the
 *  scope it is accessed through - never trust the query alone. */
export function assertRecordInScope(
  record: { organizationId: string; userId?: string },
  scope: CounterPosScope,
): void {
  if (record.organizationId !== scope.organizationId) {
    throw new CounterPosStoreError("SCOPE_MISMATCH", "Record belongs to another organization.");
  }
  if (record.userId !== undefined && record.userId !== scope.userId) {
    throw new CounterPosStoreError("SCOPE_MISMATCH", "Record belongs to another user.");
  }
}

// ---------------------------------------------------------------------------
// Identifiers, time, device
// ---------------------------------------------------------------------------

let warnedUuidFallback = false;

/** Same idea as the driver layer's generateUuid: prefer crypto.randomUUID,
 *  fall back to getRandomValues, never Date.now() alone (collides within the
 *  same millisecond). */
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (!warnedUuidFallback) {
    warnedUuidFallback = true;
    console.warn("[COUNTER POS STORE] crypto.randomUUID unavailable - using a manual UUID v4");
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toIso(now: Date = new Date()): string {
  return now.toISOString();
}

export const DEVICE_ID_META_KEY = "deviceId";

/** The installation id of this organization's database, created once. Runs in
 *  a transaction so two tabs racing on first use still agree on one id. */
export async function getOrCreateDeviceId(db: CounterPosDatabase): Promise<string> {
  return db.transaction("rw", db.meta, async () => {
    const existing = await db.meta.get(DEVICE_ID_META_KEY);
    if (existing && typeof existing.value === "string" && existing.value !== "") {
      return existing.value;
    }
    const deviceId = generateUuid();
    await db.meta.put({ key: DEVICE_ID_META_KEY, value: deviceId });
    return deviceId;
  });
}

export function getDeviceId(organizationId: string): Promise<StoreResult<string>> {
  return runStorage(organizationId, (db) => getOrCreateDeviceId(db));
}
