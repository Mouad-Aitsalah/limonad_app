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
/**
 * Bounds how long the WEB fallback's store init can take before we give up
 * on it - jeep-sqlite is known to sometimes never settle at all (its wasm
 * failing to load leaves `initWebStore()` permanently pending, see Phase 1's
 * own report). Native Android/iOS never used this timeout even in Phase 1's
 * intent - a real native `createConnection()`/`.open()` either resolves or
 * rejects on its own; racing it against an arbitrary clock only risked
 * abandoning a slow-but-succeeding open. That abandonment is the root cause
 * of "PHASE 2 BUG CRITIQUE": once the timeout fired, `getDatabase()` reset
 * `openPromise` to `null` and returned `null` for that call, but the
 * original `openDatabase()` promise kept running in the background and
 * still finished its own `createConnection()`/`.open()` against the native
 * side. The NEXT `getDatabase()` call then started a brand new
 * `openDatabase()`, calling `createConnection()` again for a database the
 * native plugin already had open - depending on timing this either threw
 * ("already exists") or raced the schema/write against a second handle,
 * and any read that hit the failing path came back as an empty result
 * (`withDatabase` returning `null` -> `getCachedProducts` etc. returning
 * `[]`) instead of the real cached rows. See this timeout's new, narrower
 * scope below - applied ONLY around the web-only `ensureWebStore()` step.
 */
const WEB_STORE_TIMEOUT_MS = 6000;

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

/** Races `promise` against a timeout WITHOUT cancelling `promise` itself -
 *  only ever used for the web-only jeep-sqlite init below, never for a
 *  native open (see WEB_STORE_TIMEOUT_MS's own doc comment for why). */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function ensureWebStore(): Promise<void> {
  if (Capacitor.getPlatform() !== "web") return;
  if (!webStoreReady) {
    webStoreReady = withTimeout(
      (async () => {
        const { defineCustomElements } = await import("jeep-sqlite/loader");
        defineCustomElements(window);
        if (!document.querySelector("jeep-sqlite")) {
          document.body.appendChild(document.createElement("jeep-sqlite"));
        }
        await customElements.whenDefined("jeep-sqlite");
        await getPlugin().initWebStore();
      })(),
      WEB_STORE_TIMEOUT_MS,
      "jeep-sqlite web store init",
    ).catch((error) => {
      // A genuinely stuck web store must not permanently block this module -
      // reset so a LATER call can try again, e.g. after a page reload fixed
      // whatever made the wasm 404. Never affects native (early return above).
      webStoreReady = null;
      throw error;
    });
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

/**
 * Returns the open connection, or `null` if SQLite isn't usable here.
 *
 * No artificial timeout wraps `openDatabase()` itself - on native Android/
 * iOS a real `createConnection()`/`.open()` call either resolves or rejects
 * on its own; a real production bug came from doing that here anyway (see
 * WEB_STORE_TIMEOUT_MS's doc comment above). The only bounded-time step is
 * the web-only jeep-sqlite init inside `ensureWebStore()`.
 */
export async function getDatabase(): Promise<SQLiteDBConnection | null> {
  if (!openPromise) {
    openPromise = openDatabase().catch((error) => {
      console.error("[OFFLINE CACHE] SQLite error", error);
      warnOnce("SQLite unavailable - offline cache disabled for this session.", error);
      openPromise = null;
      return null;
    });
  }
  return openPromise;
}

/**
 * Explicit "is SQLite actually usable right now" check, distinct from a
 * store function returning zero rows - lets pos-context.ts tell "no cache
 * yet" apart from "the cache itself is broken" (see this task's "8. CACHE
 * ABSENT VS CACHE VIDE").
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  return (await getDatabase()) !== null;
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
    console.error("[OFFLINE CACHE] SQLite error", error);
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
 *
 * BUG CRITIQUE PHASE 3 bug hunt: a transaction left open by an earlier
 * interrupted attempt on THIS SAME connection (app backgrounded/killed
 * mid-transaction, or a commit/rollback that itself failed - see the catch
 * below) would otherwise make every later beginTransaction() reject with
 * something like "cannot start a transaction within a transaction", forever,
 * until the app restarts and gets a fresh connection - `hydrateDriverOfflineCache`
 * runs this same withTransaction on every context change, so it has had many
 * chances to leave the shared connection in exactly this state before the
 * driver ever taps "Encaisser". `isTransactionActive()` is the plugin's own
 * official way to detect this; self-heal by rolling it back once before
 * starting the new one, and log loudly so this is visible if it happens.
 */
export async function withTransaction<T>(
  fn: (db: SQLiteDBConnection) => Promise<T>,
): Promise<TransactionResult<T>> {
  const db = await getDatabase();
  if (!db) return { ok: false, error: new Error("SQLite unavailable") };

  try {
    const active = await db.isTransactionActive();
    if (active.result) {
      console.error(
        "[OFFLINE SALE] a transaction was already active on this connection - rolling it back before starting a new one",
      );
      try {
        await db.rollbackTransaction();
      } catch (staleRollbackError) {
        warnOnce("Rollback of a stale leftover transaction failed.", staleRollbackError);
      }
    }
  } catch (checkError) {
    warnOnce("isTransactionActive check failed.", checkError);
  }

  let step: "beginTransaction" | "run" | "commitTransaction" = "beginTransaction";
  try {
    await db.beginTransaction();
    step = "run";
    const value = await fn(db);
    step = "commitTransaction";
    await db.commitTransaction();
    return { ok: true, value };
  } catch (error) {
    console.error("[OFFLINE CACHE] SQLite error", { step, error });
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
