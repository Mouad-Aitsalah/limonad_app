import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

// node:sqlite (built into Node 22+) is not in the installed @types/node: a minimal local type.
type Statement = { run: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] };
type Database = { exec: (sql: string) => void; prepare: (sql: string) => Statement };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Database };

/**
 * The driver app keeps its products in SQLite (cached_products) so the POS also
 * works offline. The server sends them best sellers first and saveCachedProducts
 * inserts them in that order. The read now asks for it explicitly (ORDER BY
 * rowid): without it the order depends on the query planner (a query served by
 * the primary-key index answers by product id), so it would not be guaranteed.
 * Checked here on the REAL table definition and the REAL read statement of the
 * cache store.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const schema = read("./schema.ts");
const store = read("./cache-store.ts");
const createTable = /`(CREATE TABLE IF NOT EXISTS cached_products \([\s\S]*?\))`/.exec(schema)?.[1];
const createIndex = /`(CREATE INDEX IF NOT EXISTS idx_cached_products_scope[^`]*)`/.exec(schema)?.[1];
const selectSql = /`(SELECT \* FROM cached_products WHERE organizationId = \? AND driverId = \?[^`]*)`/.exec(store)?.[1];

function openCache() {
  assert.ok(createTable && createIndex && selectSql, "statements found in the source");
  const db = new DatabaseSync(":memory:");
  db.exec(createTable!);
  db.exec(createIndex!);
  db.exec("ALTER TABLE cached_products ADD COLUMN priceToken TEXT");
  return db;
}

/** What saveCachedProducts does: delete the scope, insert in the given order. */
function save(db: Database, driverId: string, ids: string[]) {
  db.prepare("DELETE FROM cached_products WHERE organizationId = ? AND driverId = ?").run("org", driverId);
  for (const id of ids) {
    db.prepare(
      `INSERT INTO cached_products (id, organizationId, driverId, reference, name, salePriceHT, salePriceTTC, taxRate, availableQuantity, syncedAt)
       VALUES (?, 'org', ?, ?, ?, 10, 12, 20, 5, 'now')`,
    ).run(id, driverId, `REF-${id}`, `Produit ${id}`);
  }
}

const readIds = (db: Database, driverId: string, sql = selectSql!) =>
  (db.prepare(sql).all("org", driverId) as Array<{ id: string }>).map((row) => row.id);

test("the cache read returns the products in the order they were saved (best sellers first)", () => {
  const db = openCache();
  // ids chosen so that the primary-key order (alphabetical) is the OPPOSITE of the ranking
  save(db, "driver-1", ["zz-best-seller", "mm-second", "aa-never-sold"]);
  assert.deepEqual(readIds(db, "driver-1"), ["zz-best-seller", "mm-second", "aa-never-sold"]);
  // WITHOUT the ORDER BY the order depends on the query planner (an index on the product id answers in
  // alphabetical order): the explicit rowid order makes it a guarantee, whatever plan SQLite picks
  const viaIdIndex = "SELECT id FROM cached_products WHERE organizationId = ? AND driverId = ?";
  assert.deepEqual(readIds(db, "driver-1", viaIdIndex), ["aa-never-sold", "mm-second", "zz-best-seller"]);
});

test("a refresh replaces the order with the new ranking; another driver's cache is independent", () => {
  const db = openCache();
  save(db, "driver-1", ["a", "b", "c"]);
  save(db, "driver-2", ["y", "x"]);
  save(db, "driver-1", ["c", "a", "d", "b"]);
  assert.deepEqual(readIds(db, "driver-1"), ["c", "a", "d", "b"]);
  assert.deepEqual(readIds(db, "driver-2"), ["y", "x"]);
});

test("no schema change: the order comes from the existing rowid (no new column, no local migration)", () => {
  assert.equal(/sold/i.test(createTable!), false);
  assert.match(selectSql!, /ORDER BY rowid ASC$/);
  // the context rebuilt from the cache keeps the array order (no re-sort on the way)
  const context = read("./pos-context.ts");
  assert.match(context, /const dtoProducts: DriverPosProductDto\[\] = products\.map\(/);
  assert.equal(/products\.sort|dtoProducts\.sort|\.sort\(/.test(context), false);
});
