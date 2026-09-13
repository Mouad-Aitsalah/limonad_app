/**
 * SQLite schema for the offline POS chauffeur cache (Phase 1 foundation).
 *
 * BUG ANDROID CONFIRMÉ (Phase 3 bug hunt) - "no such table: offline_sales":
 * this used to be one flat `SCHEMA_STATEMENTS` array, joined with `;` and
 * executed as a single multi-statement `db.execute()` call on every
 * `openDatabase()`. That worked for `cached_products`/`cached_customers`/
 * `cached_truck_stock` on the affected device but never actually created
 * `offline_sales`/`offline_sale_lines`/`sync_outbox`/`offline_metadata` -
 * i.e. everything BEFORE that point in the joined batch was applied, but
 * not everything after. Whatever exactly the Android plugin did with that
 * giant joined string, the fix is to never rely on it again: statements are
 * now grouped into versioned migrations, each one applied with its own
 * `db.execute()` call per statement (never joined), inside one transaction,
 * gated by `PRAGMA user_version` - see database.ts's `migrateDatabase()`.
 *
 * Grouping into versions here is only a record of WHEN each table was
 * introduced, for future ALTER-TABLE-style migrations - every statement
 * below is still `CREATE ... IF NOT EXISTS`, so re-applying an already-
 * applied version's statements again is always a safe no-op. A later phase
 * that needs to alter an existing table's shape should add a NEW version
 * entry with real ALTER TABLE statements, never edit an already-shipped
 * version's statements in place.
 *
 * Deliberately absent: any `CHECK (quantity >= 0)` on stock/credit columns -
 * truck stock and offline sales must be able to go negative, matching the
 * server's own existing rule (see lib/server/driver-sales.ts).
 */

export type SchemaMigration = {
  version: number;
  statements: string[];
};

export const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    // Phase 1: cached reference data + "who is this device logged in as".
    version: 1,
    statements: [
      // Singleton "who is this device logged in as" row. Not the isolation
      // boundary by itself - every other table below still carries its own
      // organizationId/driverId and every store function filters on them.
      `CREATE TABLE IF NOT EXISTS offline_context (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        organizationId TEXT NOT NULL,
        organizationName TEXT,
        userId TEXT NOT NULL,
        userName TEXT NOT NULL,
        driverId TEXT NOT NULL,
        driverName TEXT NOT NULL,
        truckId TEXT,
        truckName TEXT,
        stockLocationId TEXT,
        tourId TEXT,
        tourCode TEXT,
        tourStatus TEXT,
        syncedAt TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS cached_products (
        id TEXT NOT NULL,
        organizationId TEXT NOT NULL,
        driverId TEXT NOT NULL,
        reference TEXT NOT NULL,
        barcode TEXT,
        name TEXT NOT NULL,
        imageUrl TEXT,
        salePriceHT REAL NOT NULL,
        salePriceTTC REAL NOT NULL,
        taxRate REAL NOT NULL,
        availableQuantity REAL NOT NULL,
        supplierId TEXT,
        supplierName TEXT,
        syncedAt TEXT NOT NULL,
        PRIMARY KEY (organizationId, driverId, id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cached_products_scope ON cached_products (organizationId, driverId)`,

      `CREATE TABLE IF NOT EXISTS cached_customers (
        id TEXT NOT NULL,
        organizationId TEXT NOT NULL,
        driverId TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        status TEXT NOT NULL,
        syncedAt TEXT NOT NULL,
        PRIMARY KEY (organizationId, driverId, id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cached_customers_scope ON cached_customers (organizationId, driverId)`,

      // No CHECK on the quantity columns - see this file's own doc comment.
      `CREATE TABLE IF NOT EXISTS cached_truck_stock (
        productId TEXT NOT NULL,
        organizationId TEXT NOT NULL,
        driverId TEXT NOT NULL,
        truckId TEXT NOT NULL,
        quantity REAL NOT NULL,
        reservedQuantity REAL NOT NULL DEFAULT 0,
        availableQuantity REAL NOT NULL,
        lastSyncedAt TEXT NOT NULL,
        PRIMARY KEY (organizationId, driverId, productId)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cached_truck_stock_scope ON cached_truck_stock (organizationId, driverId)`,
    ],
  },
  {
    // Phase 3: local offline sales + their outbox entries. On at least one
    // real device this never actually got created by the old joined-batch
    // `execute()` call - see this file's own top comment.
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS offline_sales (
        localId TEXT PRIMARY KEY,
        clientMutationId TEXT NOT NULL UNIQUE,
        organizationId TEXT NOT NULL,
        driverId TEXT NOT NULL,
        truckId TEXT,
        tourId TEXT,
        stockLocationId TEXT,
        customerId TEXT,
        paymentMethod TEXT NOT NULL,
        syncStatus TEXT NOT NULL DEFAULT 'LOCAL_DRAFT',
        soldAt TEXT NOT NULL,
        createdAtLocal TEXT NOT NULL,
        syncedAt TEXT,
        serverSaleId TEXT,
        officialDisplayNumber TEXT,
        subtotalHT REAL NOT NULL,
        taxAmount REAL NOT NULL,
        totalTTC REAL NOT NULL,
        paidAmount REAL NOT NULL,
        creditAmount REAL NOT NULL,
        syncAttempts INTEGER NOT NULL DEFAULT 0,
        lastSyncError TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_offline_sales_scope ON offline_sales (organizationId, driverId)`,
      `CREATE INDEX IF NOT EXISTS idx_offline_sales_status ON offline_sales (syncStatus)`,

      `CREATE TABLE IF NOT EXISTS offline_sale_lines (
        id TEXT PRIMARY KEY,
        offlineSaleId TEXT NOT NULL REFERENCES offline_sales(localId) ON DELETE CASCADE,
        productId TEXT NOT NULL,
        productNameSnapshot TEXT NOT NULL,
        quantity REAL NOT NULL,
        unitPriceSnapshot REAL NOT NULL,
        taxRateSnapshot REAL NOT NULL,
        discountSnapshot REAL NOT NULL DEFAULT 0,
        totalHT REAL NOT NULL,
        taxAmount REAL NOT NULL,
        totalTTC REAL NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_offline_sale_lines_sale ON offline_sale_lines (offlineSaleId)`,

      `CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        entityType TEXT NOT NULL,
        entityLocalId TEXT NOT NULL,
        operation TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        attemptCount INTEGER NOT NULL DEFAULT 0,
        nextAttemptAt TEXT,
        lastError TEXT,
        lockedAt TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity ON sync_outbox (entityType, entityLocalId)`,

      // Small free-form key/value store - e.g. the schema version actually
      // applied on this device, for a future migration step to compare against.
      `CREATE TABLE IF NOT EXISTS offline_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
    ],
  },
  {
    // PHASE 4A.1 - "PRIX OFFLINE FIGÉ ET VÉRIFIABLE". Both columns are
    // nullable, plain additive ALTER TABLEs - never touches existing rows
    // (a device with a real PENDING_SYNC sale already on it keeps that sale
    // exactly as-is, with priceToken simply NULL on its lines - see
    // lib/server/driver-sales.ts's own "legacy line" fallback for how the
    // server accepts that). cached_products.priceToken is refreshed on
    // every online context fetch (see bootstrap.ts); offline_sale_lines.
    // priceToken is a PERMANENT SNAPSHOT copied from the cache at the exact
    // moment of the offline sale - never re-read from cached_products later
    // (a subsequent cache refresh must never retroactively change what an
    // already-confirmed sale claims to have shown the driver).
    version: 3,
    statements: [
      `ALTER TABLE cached_products ADD COLUMN priceToken TEXT`,
      `ALTER TABLE offline_sale_lines ADD COLUMN priceToken TEXT`,
    ],
  },
];

/** Highest version defined above - passed to the plugin's own
 *  `createConnection(..., version, ...)` param (its own, separate
 *  versioning concept, inert here since this app never registers native
 *  `addUpgradeStatement` callbacks - see database.ts). */
export const SCHEMA_VERSION = Math.max(...SCHEMA_MIGRATIONS.map((migration) => migration.version));

/** Every table this schema defines, across all migration versions - used
 *  only by database.ts's post-migration sqlite_master verification. */
export const EXPECTED_TABLES = [
  "offline_context",
  "cached_products",
  "cached_customers",
  "cached_truck_stock",
  "offline_sales",
  "offline_sale_lines",
  "sync_outbox",
  "offline_metadata",
];
