import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { buildSyncPayload, resolveLineDiscountRate } from "./sync-payload";
import { SCHEMA_MIGRATIONS } from "./schema";
import type { OfflineSaleLineInput, OfflineSaleWithLines } from "./types";

// node:sqlite (built into Node 22+) is not in the installed @types/node: a minimal local type.
type Statement = { run: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] };
type Database = { exec: (sql: string) => void; prepare: (sql: string) => Statement };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Database };

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function migrate(db: Database, upTo: number, from = 0) {
  for (const migration of SCHEMA_MIGRATIONS.filter((m) => m.version > from && m.version <= upTo)) {
    for (const statement of migration.statements) db.exec(statement);
  }
}

describe("local SQLite migration v8 (custom price + cached cost)", () => {
  it("is a new, additive version: two nullable columns, no edit of an earlier version", () => {
    const v8 = SCHEMA_MIGRATIONS.find((migration) => migration.version === 8)!;
    assert.deepEqual(v8.statements, [
      "ALTER TABLE cached_products ADD COLUMN purchasePriceHT REAL",
      "ALTER TABLE offline_sale_lines ADD COLUMN customUnitPriceTTC REAL",
    ]);
    assert.deepEqual(SCHEMA_MIGRATIONS.map((migration) => migration.version), [1, 2, 3, 4, 5, 6, 7, 8]);
    // version 7 is exactly what it was
    assert.deepEqual(SCHEMA_MIGRATIONS.find((migration) => migration.version === 7)!.statements, ["ALTER TABLE offline_sales ADD COLUMN roundingAmount REAL"]);
  });

  it("a device at v7 with a pending offline sale keeps it untouched: new columns NULL (no custom price, unknown cost)", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, 7);
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(
      `INSERT INTO cached_products (id, organizationId, driverId, reference, name, salePriceHT, salePriceTTC, taxRate, availableQuantity, syncedAt, priceToken)
       VALUES ('p1', 'org', 'drv', 'R1', 'Coca', 16.67, 20, 20, 5, 'now', 'tok')`,
    ).run();
    db.prepare(
      `INSERT INTO offline_sale_lines (id, offlineSaleId, productId, productNameSnapshot, quantity, unitPriceSnapshot, taxRateSnapshot, discountSnapshot, totalHT, taxAmount, totalTTC, priceToken)
       VALUES ('l1', 's1', 'p1', 'Coca', 2, 20, 20, 0, 33.33, 6.67, 40, 'tok')`,
    ).run();

    migrate(db, 8, 7);

    const product = db.prepare("SELECT purchasePriceHT, salePriceTTC, priceToken FROM cached_products WHERE id = 'p1'").all()[0] as Record<string, unknown>;
    assert.deepEqual({ ...product }, { purchasePriceHT: null, salePriceTTC: 20, priceToken: "tok" });
    const line = db.prepare("SELECT customUnitPriceTTC, unitPriceSnapshot, totalTTC FROM offline_sale_lines WHERE id = 'l1'").all()[0] as Record<string, unknown>;
    assert.deepEqual({ ...line }, { customUnitPriceTTC: null, unitPriceSnapshot: 20, totalTTC: 40 });
  });

  it("a custom price of 0 is stored as 0, not NULL (and NULL stays 'no custom price')", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, 8);
    db.exec("PRAGMA foreign_keys = OFF");
    const insert = db.prepare(
      `INSERT INTO offline_sale_lines (id, offlineSaleId, productId, productNameSnapshot, quantity, unitPriceSnapshot, taxRateSnapshot, discountSnapshot, totalHT, taxAmount, totalTTC, priceToken, customUnitPriceTTC)
       VALUES (?, 's1', 'p1', 'Coca', 1, 20, 20, 0, 0, 0, 0, 'tok', ?)`,
    );
    insert.run("zero", 0);
    insert.run("none", null);
    insert.run("fifteen", 15);
    const rows = db.prepare("SELECT id, customUnitPriceTTC FROM offline_sale_lines ORDER BY id").all() as Array<{ id: string; customUnitPriceTTC: number | null }>;
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.customUnitPriceTTC])), { fifteen: 15, none: null, zero: 0 });
  });

  it("the stores write / read the new columns (0 kept: `?? null`, never `|| null`)", () => {
    const sales = read("./sales-store.ts");
    assert.match(sales, /totalHT, taxAmount, totalTTC, priceToken, customUnitPriceTTC\s*\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/);
    assert.match(sales, /line\.customUnitPriceTTC \?\? null,/);
    assert.match(sales, /customUnitPriceTTC: line\.customUnitPriceTTC == null \? null : Number\(line\.customUnitPriceTTC\),/);
    const cache = read("./cache-store.ts");
    assert.match(cache, /supplierId, supplierName, priceToken, purchasePriceHT, syncedAt/);
    assert.match(cache, /purchasePriceHT: row\.purchasePriceHT == null \? null : Number\(row\.purchasePriceHT\),/);
    assert.match(read("./pos-context.ts"), /product\.purchasePriceHT != null \? \{ purchasePriceHT: product\.purchasePriceHT \} : \{\}/);
  });
});

function line(overrides: Partial<OfflineSaleLineInput> = {}): OfflineSaleWithLines["lines"][number] {
  return {
    id: "l1",
    offlineSaleId: "s1",
    productId: "p1",
    productNameSnapshot: "Coca",
    quantity: 2,
    unitPriceSnapshot: 12,
    taxRateSnapshot: 20,
    discountSnapshot: 0,
    totalHT: 20,
    taxAmount: 4,
    totalTTC: 24,
    priceToken: "signed-token",
    ...overrides,
  } as OfflineSaleWithLines["lines"][number];
}

function sale(lines: OfflineSaleWithLines["lines"]): OfflineSaleWithLines {
  return {
    localId: "local",
    clientMutationId: "11111111-1111-4111-8111-111111111111",
    localReference: "OFF-1",
    soldAt: "2026-10-14T10:00:00.000Z",
    customerId: null,
    paymentMethod: "CASH",
    totalTTC: 24,
    roundingAmount: 0,
    lines,
  } as unknown as OfflineSaleWithLines;
}

describe("offline sync payload - custom price", () => {
  it("a line without a typed price is sent exactly as before: no custom field", () => {
    const result = buildSyncPayload(sale([line()]));
    assert.ok(result.ok);
    assert.deepEqual(result.body.lines[0], { productId: "p1", quantity: 2, unitPriceTTC: 12, priceToken: "signed-token", discountRate: 0 });
    for (const empty of [null, undefined]) {
      const again = buildSyncPayload(sale([line({ customUnitPriceTTC: empty })]));
      assert.ok(again.ok);
      assert.equal("customUnitPriceTTC" in again.body.lines[0], false);
    }
  });

  it("a typed price travels apart; the signed catalogue price and token are untouched", () => {
    const result = buildSyncPayload(sale([line({ customUnitPriceTTC: 15, totalHT: 25, taxAmount: 5, totalTTC: 30 })]));
    assert.ok(result.ok);
    assert.deepEqual(result.body.lines[0], {
      productId: "p1",
      quantity: 2,
      unitPriceTTC: 12,
      priceToken: "signed-token",
      discountRate: 0,
      customUnitPriceTTC: 15,
    });
  });

  it("a typed price of 0 DH is sent (0 is a price)", () => {
    const result = buildSyncPayload(sale([line({ customUnitPriceTTC: 0, totalHT: 0, taxAmount: 0, totalTTC: 0 })]));
    assert.ok(result.ok);
    assert.equal(result.body.lines[0].customUnitPriceTTC, 0);
    assert.equal(result.body.lines[0].discountRate, 0);
  });

  it("the discount of a legacy-looking line is rebuilt from the price actually applied, not from the catalogue price", () => {
    // typed 15 DH x 2, no discount: stored HT 25 -> rate 0 (against the catalogue price it would look like a 25 % discount)
    const plain = resolveLineDiscountRate(line({ customUnitPriceTTC: 15, totalHT: 25, taxAmount: 5, totalTTC: 30 }));
    assert.deepEqual(plain, { ok: true, discountRate: 0 });
    // an explicit discount snapshot is always sent as is
    const explicit = resolveLineDiscountRate(line({ customUnitPriceTTC: 15, discountSnapshot: 10 }));
    assert.deepEqual(explicit, { ok: true, discountRate: 10 });
    // a free line has nothing to reconstruct
    assert.deepEqual(resolveLineDiscountRate(line({ customUnitPriceTTC: 0, totalHT: 0, taxAmount: 0, totalTTC: 0 })), { ok: true, discountRate: 0 });
  });
});
