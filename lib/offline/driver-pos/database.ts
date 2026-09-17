import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";

import { EXPECTED_TABLES, SCHEMA_MIGRATIONS, SCHEMA_VERSION } from "./schema";

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

/**
 * TEMPORARY DEV DIAGNOSTIC (bug hunt - "cached_products write failed,
 * [object Object]"): Android's WebView console -> Logcat bridge stringifies
 * a console.error's non-string arguments with a bare `.toString()` instead
 * of deep-inspecting them the way Chrome DevTools does - a thrown/rejected
 * SQLite error object (or even a plain `{ step, error }` object literal)
 * therefore only ever showed up as the literal text "[object Object]" on a
 * real device, never its actual message/code/contents. This never changes
 * what is caught or how a failure is handled - every call site below still
 * fails exactly as soft as before; it only makes the SAME already-caught
 * error legible in Logcat: every own enumerable property the rejected value
 * carries (message/code/result/whatever the native plugin actually
 * attached), plus a JSON dump. No secrets ever flow through this path (only
 * SQL error details), so nothing here needs redaction.
 */
function describeSqliteError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(error)) {
      details[key] = (error as unknown as Record<string, unknown>)[key];
    }
    return details;
  }
  if (error && typeof error === "object") {
    return { ...(error as Record<string, unknown>) };
  }
  return { value: error };
}

/** See describeSqliteError's own doc comment - logs both the raw value (in
 *  case the environment DOES deep-inspect it, e.g. Chrome DevTools) and an
 *  explicit JSON dump of its own properties (what actually shows up on
 *  Android Logcat). `context` names which catch block logged it (this
 *  module's three, plus bootstrap.ts's own outer guard), so every site stays
 *  distinguishable. Exported only for that reuse - never called from outside
 *  an already-existing catch block, so this changes no control flow. */
export function logSqliteError(context: string, error: unknown): void {
  console.error(`[OFFLINE CACHE] SQLite error - ${context}`, error);
  const details = describeSqliteError(error);
  try {
    console.error(`[OFFLINE CACHE] SQLite error details - ${context}`, JSON.stringify(details, null, 2));
  } catch {
    console.error(`[OFFLINE CACHE] SQLite error details (unserializable) - ${context}`, details);
  }
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

/**
 * BUG ANDROID CONFIRMÉ (Phase 3 bug hunt) - "no such table: offline_sales":
 * versioned, transactional schema migration gated by SQLite's own
 * `PRAGMA user_version`. Replaces the previous single
 * `db.execute(SCHEMA_STATEMENTS.join(";"))` call, whose giant joined
 * multi-statement string apparently stopped applying partway through on at
 * least one real device - cached_products/cached_customers/cached_truck_stock
 * (earlier in that batch) got created, offline_sales/offline_sale_lines/
 * sync_outbox/offline_metadata (later in the same batch) never did. Every
 * statement is now executed individually and awaited on its own, inside an
 * explicit transaction per migration version, so a failure can never again
 * silently skip the rest of a batch.
 *
 * `PRAGMA user_version` was never actually being set by the old code (it
 * only ever passed a "version" to the plugin's own `createConnection`,
 * which is a different, inert concept here - see this function's own
 * caller). So an already-provisioned device's `user_version` is expected to
 * still read 0 today regardless of which tables it actually has - migrations
 * are version-gated on `> currentVersion`, not skipped by "must already be
 * fully applied", and every statement is `CREATE ... IF NOT EXISTS` (see
 * schema.ts), so re-applying an already-applied version's statements again
 * is always a safe no-op (this is what keeps "TEST 8. MIGRATION
 * IDEMPOTENTE" true) and NEVER drops or rewrites existing cache data.
 */
async function migrateDatabase(db: SQLiteDBConnection): Promise<void> {
  const beforeRows = await db.query("PRAGMA user_version");
  const currentVersion = Number((beforeRows.values ?? [])[0]?.user_version ?? 0);
  console.log("[OFFLINE DB] user_version (before):", currentVersion);

  const pending = SCHEMA_MIGRATIONS.filter((migration) => migration.version > currentVersion);
  if (pending.length === 0) {
    console.log("[OFFLINE DB] schema already up to date at version", currentVersion);
  }

  for (const migration of pending) {
    console.log(`[OFFLINE DB] applying migration to version ${migration.version}`);
    try {
      await db.beginTransaction();
      for (const statement of migration.statements) {
        await db.execute(statement, false);
      }
      await db.execute(`PRAGMA user_version = ${migration.version}`, false);
      await db.commitTransaction();
      console.log(`[OFFLINE DB] migration to version ${migration.version} committed`);
    } catch (error) {
      console.error(`[OFFLINE DB] migration to version ${migration.version} failed`, error);
      try {
        await db.rollbackTransaction();
      } catch (rollbackError) {
        warnOnce("Rollback of a failed schema migration itself failed.", rollbackError);
      }
      // Never leave the caller believing this device has a usable schema -
      // openDatabase()/getDatabase() must treat this exactly like any other
      // "SQLite unavailable" failure (see getDatabase()'s own doc comment).
      throw error;
    }
  }

  const afterRows = await db.query("PRAGMA user_version");
  const afterVersion = Number((afterRows.values ?? [])[0]?.user_version ?? 0);
  console.log("[OFFLINE DB] user_version (after):", afterVersion);

  await logInstalledTables(db);
}

/** TEMPORARY (Phase 3 bug hunt) - "11. VÉRIFIER LES TABLES RÉELLES": logs
 *  OK/MISSING for every table this schema is supposed to define, read
 *  straight from sqlite_master so it reflects reality, not assumptions. */
async function logInstalledTables(db: SQLiteDBConnection): Promise<void> {
  const result = await db.query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  const installed = new Set((result.values ?? []).map((row) => String(row.name)));
  for (const table of EXPECTED_TABLES) {
    console.log(`[OFFLINE DB] table ${table}: ${installed.has(table) ? "OK" : "MISSING"}`);
  }
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
  // "9. ENSURE DATABASE READY": migrations run and fully commit here, BEFORE
  // openDatabase() (and therefore getDatabase()) ever resolves with this
  // connection - no caller can reach withDatabase()/withTransaction() and
  // touch a partially-migrated schema, since they can only get a `db`
  // handle back once this whole promise chain has settled.
  await migrateDatabase(db);
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
      logSqliteError("getDatabase/openDatabase", error);
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
 * ÉTAPE 15A/15B - FIFO async mutex around every operation that actually
 * touches the shared SQLite connection. `beginTransaction`/`commitTransaction`/
 * `rollbackTransaction`, and the plugin's own implicit per-`db.run()`
 * transaction (its `transaction` option defaults to `true` - see
 * @capacitor-community/sqlite's own capSQLiteRunOptions), are both state
 * global to the CONNECTION, not scoped to whichever caller happens to be
 * running. Before this queue, several independent callers (hydrateDriverOfflineCache
 * firing from up to four separate places at once, a reconnect-triggered sync
 * batch's own status updates, a live offline sale, ...) could each touch
 * that global state at the same time - and withTransaction's own self-heal
 * (isTransactionActive -> rollbackTransaction, see below) could roll back a
 * SIBLING caller's still-in-progress transaction instead of a genuine
 * leftover, which is exactly what produced the observed
 * "UNIQUE constraint failed" and "CommitTransaction: ... no current
 * transaction" errors (see ÉTAPE 15A's audit).
 *
 * `runExclusive` makes every withDatabase()/withTransaction() body run to
 * completion - success OR failure - before the next queued one starts, so at
 * most one of them is ever mid-flight against `db`. `getDatabase()` itself is
 * deliberately called OUTSIDE this queue in both functions below (it is
 * already de-duplicated by its own memoized `openPromise`, and a call that
 * fails fast because SQLite is unavailable should never sit in this queue).
 *
 * NOT reentrant: `fn` must never itself call withDatabase()/withTransaction()
 * - a nested call would wait on `operationQueue`, which in turn only advances
 * once the OUTER call's own task settles, so it would never resolve. Verified
 * for every current caller (context-store.ts, cache-store.ts, sales-store.ts's
 * createOfflineSale) - each only calls `db.run`/`db.query` directly inside its
 * own callback, never one of these two exported functions again.
 */
let operationQueue: Promise<void> = Promise.resolve();

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const previous = operationQueue;
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  operationQueue = next;
  return previous.then(() => task()).finally(() => release());
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
  return runExclusive(async () => {
    try {
      return await fn(db);
    } catch (error) {
      logSqliteError("withDatabase", error);
      warnOnce("SQLite operation failed.", error);
      return null;
    }
  });
}

export type TransactionResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Explicit atomic transaction (see sales-store.ts's createOfflineSale) -
 * BEGIN, run `fn`, COMMIT; any thrown error triggers a ROLLBACK before the
 * failure is returned to the caller. `fn` must pass `transaction: false` to
 * every `db.run`/`db.execute` call it makes (the plugin's own per-call
 * transaction wrapping would otherwise nest inside this one, which SQLite
 * does not support). The whole body below runs inside `runExclusive` (see
 * its own doc comment above withDatabase) - no sibling withTransaction()/
 * withDatabase() call can be mid-flight while this one runs.
 *
 * BUG CRITIQUE PHASE 3 bug hunt / ÉTAPE 15B: a transaction left open by an
 * earlier interrupted attempt on THIS SAME connection (app backgrounded/
 * killed mid-transaction, or a commit/rollback that itself failed - see the
 * catch below) would otherwise make every later beginTransaction() reject
 * with something like "cannot start a transaction within a transaction",
 * forever, until the app restarts and gets a fresh connection.
 * `isTransactionActive()` is the plugin's own official way to detect this;
 * self-heal by rolling it back once before starting the new one, and log
 * loudly so this is visible if it happens.
 *
 * ÉTAPE 15A found that, WITHOUT the queue above, this self-heal was actually
 * the mechanism destroying other callers' work: several independent chains
 * could each be mid-transaction on the same connection at once, so this
 * rollback frequently hit a SIBLING's still-live transaction rather than a
 * genuine orphan, producing the observed "UNIQUE constraint failed" /
 * "no current transaction" errors. Now that `runExclusive` guarantees no
 * other withTransaction()/withDatabase() body is ever running concurrently,
 * an active transaction found here can only be a real cross-session leftover
 * (e.g. the native connection survived a JS/WebView reload while this
 * module's own state, including `operationQueue`, was reset) - never a live
 * sibling - so this self-heal is kept, but is now provably safe.
 */
export async function withTransaction<T>(
  fn: (db: SQLiteDBConnection) => Promise<T>,
): Promise<TransactionResult<T>> {
  const db = await getDatabase();
  if (!db) return { ok: false, error: new Error("SQLite unavailable") };

  return runExclusive(async () => {
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
      logSqliteError(`withTransaction (step=${step})`, error);
      try {
        await db.rollbackTransaction();
      } catch (rollbackError) {
        warnOnce("SQLite rollback itself failed.", rollbackError);
      }
      warnOnce("SQLite transaction rolled back.", error);
      return { ok: false, error };
    }
  });
}

export type OfflineDbDiagnostic = {
  userVersion: number;
  tables: Record<string, boolean>;
};

/**
 * TEMPORARY (Phase 3 bug hunt) - "10. DIAGNOSTIC TEMPORAIRE": on-demand
 * snapshot of the migrated schema's actual state, for driver-pos-view.tsx
 * to optionally show next to its existing (also temporary) cache-counts
 * diagnostic. Read-only, safe to call any time; `null` only when SQLite
 * itself is unavailable (same meaning as everywhere else in this module).
 */
export async function getOfflineDbDiagnostic(): Promise<OfflineDbDiagnostic | null> {
  const db = await getDatabase();
  if (!db) return null;
  const versionRows = await db.query("PRAGMA user_version");
  const userVersion = Number((versionRows.values ?? [])[0]?.user_version ?? 0);
  const tableRows = await db.query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  const installed = new Set((tableRows.values ?? []).map((row) => String(row.name)));
  const tables: Record<string, boolean> = {};
  for (const table of EXPECTED_TABLES) tables[table] = installed.has(table);
  return { userVersion, tables };
}

export function nowIso(): string {
  return new Date().toISOString();
}
