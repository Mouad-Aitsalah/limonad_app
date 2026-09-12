import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";

import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "./schema";

/**
 * Connection bootstrap for the offline POS chauffeur database.
 *
 * Phase 1 rule, non-negotiable: nothing in this module may ever break the
 * online POS. Every public function here fails soft - a thrown error from
 * the plugin (missing native implementation, jeep-sqlite not registered,
 * disk error, whatever) is caught, logged once, and turned into `null` /
 * `false` so callers (context-store.ts, cache-store.ts, ...) can just treat
 * "offline cache unavailable" as a normal, expected outcome.
 *
 * On native Android/iOS this talks to the real Capacitor SQLite plugin. On
 * the web platform (this app's own regular browser deployment, and this
 * repo's dev/test loop) it transparently falls back to jeep-sqlite's
 * sql.js-backed web store - the same plugin, its own documented way to run
 * without a device. If that fallback isn't available either (e.g. the
 * custom element never loads), `getDatabase()` just resolves to `null`.
 */

const DB_NAME = "comdis_driver_pos";
/** Bounds how long "open the database" can ever take - a stuck web-store
 *  init (jeep-sqlite not loading, wasm 404, whatever) must resolve to
 *  "unavailable" within a bounded time, never hang the caller forever. */
const OPEN_TIMEOUT_MS = 6000;

let sqlitePlugin: SQLiteConnection | null = null;
let webStoreReady: Promise<void> | null = null;
let openPromise: Promise<SQLiteDBConnection | null> | null = null;
let warnedOnce = false;

function warnOnce(message: string, error: unknown) {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(`[offline/driver-pos] ${message}`, error);
}

function getPlugin(): SQLiteConnection {
  if (!sqlitePlugin) sqlitePlugin = new SQLiteConnection(CapacitorSQLite);
  return sqlitePlugin;
}

async function ensureWebStore(): Promise<void> {
  if (Capacitor.getPlatform() !== "web") return;
  if (!webStoreReady) {
    webStoreReady = (async () => {
      const { defineCustomElements } = await import("jeep-sqlite/loader");
      defineCustomElements(window);
      if (!document.querySelector("jeep-sqlite")) {
        document.body.appendChild(document.createElement("jeep-sqlite"));
      }
      await customElements.whenDefined("jeep-sqlite");
      await getPlugin().initWebStore();
    })();
  }
  return webStoreReady;
}

async function openDatabase(): Promise<SQLiteDBConnection> {
  const plugin = getPlugin();
  await ensureWebStore();

  // Recommended by the plugin's own docs: reconcile the native side's
  // connection registry with this JS instance's before touching it - avoids
  // "connection already exists" errors after a Fast Refresh / hot reload.
  await plugin.checkConnectionsConsistency();
  const existing = await plugin.isConnection(DB_NAME, false);

  const db = existing.result
    ? await plugin.retrieveConnection(DB_NAME, false)
    : await plugin.createConnection(DB_NAME, false, "no-encryption", SCHEMA_VERSION, false);

  await db.open();
  await db.execute(SCHEMA_STATEMENTS.join(";"));
  return db;
}

function withOpenTimeout(promise: Promise<SQLiteDBConnection>): Promise<SQLiteDBConnection> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`SQLite open timed out after ${OPEN_TIMEOUT_MS}ms`)),
      OPEN_TIMEOUT_MS,
    );
    promise.then(
      (db) => {
        clearTimeout(timer);
        resolve(db);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Returns the open connection, or `null` if SQLite isn't usable here. */
export async function getDatabase(): Promise<SQLiteDBConnection | null> {
  if (!openPromise) {
    openPromise = withOpenTimeout(openDatabase()).catch((error) => {
      warnOnce("SQLite unavailable - offline cache disabled for this session.", error);
      openPromise = null;
      return null;
    });
  }
  return openPromise;
}

/**
 * Runs `fn` against the database, swallowing any failure into `null` so a
 * broken local cache can never surface as an error to the online POS.
 */
export async function withDatabase<T>(
  fn: (db: SQLiteDBConnection) => Promise<T>,
): Promise<T | null> {
  const db = await getDatabase();
  if (!db) return null;
  try {
    return await fn(db);
  } catch (error) {
    warnOnce("SQLite operation failed.", error);
    return null;
  }
}

export type TransactionResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Explicit atomic transaction (see sales-store.ts's createOfflineSale) -
 * BEGIN, run `fn`, COMMIT; any thrown error triggers a ROLLBACK before the
 * failure is returned to the caller. `fn` must pass `transaction: false` to
 * every `db.run`/`db.execute` call it makes (the plugin's own per-call
 * transaction wrapping would otherwise nest inside this one, which SQLite
 * does not support).
 */
export async function withTransaction<T>(
  fn: (db: SQLiteDBConnection) => Promise<T>,
): Promise<TransactionResult<T>> {
  const db = await getDatabase();
  if (!db) return { ok: false, error: new Error("SQLite unavailable") };
  try {
    await db.beginTransaction();
    const value = await fn(db);
    await db.commitTransaction();
    return { ok: true, value };
  } catch (error) {
    try {
      await db.rollbackTransaction();
    } catch (rollbackError) {
      warnOnce("SQLite rollback itself failed.", rollbackError);
    }
    warnOnce("SQLite transaction rolled back.", error);
    return { ok: false, error };
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
