import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { computePriceHTFromTTC } from "@/lib/product-pricing";
import {
  classifyPreloadedRows,
  type ClassifiedProductRow,
  type ProductImportPreload,
  type ProductImportRow,
} from "@/lib/products-import-rules";
import { chunkRows, isImportableStatus } from "@/lib/products-import-shared";
import { writeImportBatch, type ImportLineTx, type ImportWriteStore } from "@/lib/products-import-writer";

// ---- an in-memory database with the same guarantees the import relies on -------------
// * one transaction per line: what a failing line wrote is rolled back (all or nothing)
// * Supplier: unique (organizationId, code) - a duplicate throws Prisma's P2002
// * every read and write is scoped to ONE organisation (the store is bound to it)

type Supplier = { id: string; organizationId: string; code: string; name: string; active: boolean; createdByUserId: string | null };
type Category = { id: string; organizationId: string; name: string };
type Product = {
  id: string;
  organizationId: string;
  reference: string;
  name: string;
  categoryId: string;
  defaultSupplierId: string;
  purchasePrice: number;
  salePrice: number;
  taxRate: number;
};
type State = { suppliers: Supplier[]; categories: Category[]; products: Product[]; stock: Record<string, number>; movements: number };

class FakeDb {
  state: State = { suppliers: [], categories: [], products: [], stock: {}, movements: 0 };
  private sequence = 0;
  /** ref_fournisseur whose creation fails (a database error on that INSERT). */
  failSupplierCodes = new Set<string>();
  /** Product references whose creation fails AFTER the supplier was created in the same line. */
  failProductReferences = new Set<string>();
  supplierInserts = 0;

  id(prefix: string) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  addSupplier(organizationId: string, code: string, active = true): Supplier {
    const supplier = { id: this.id("sup"), organizationId, code, name: code, active, createdByUserId: null };
    this.state.suppliers.push(supplier);
    return supplier;
  }

  addCategory(organizationId: string, name: string): Category {
    const category = { id: this.id("cat"), organizationId, name };
    this.state.categories.push(category);
    return category;
  }

  suppliersOf(organizationId: string) {
    return this.state.suppliers.filter((supplier) => supplier.organizationId === organizationId);
  }

  /** What lib/server/products-import.ts preloads for the classification (one organisation). */
  preload(organizationId: string): ProductImportPreload {
    const supplierById = new Map(this.state.suppliers.map((supplier) => [supplier.id, supplier]));
    const categoryById = new Map(this.state.categories.map((category) => [category.id, category]));
    const products = this.state.products.filter((product) => product.organizationId === organizationId);
    return {
      products: products.map((product) => ({
        id: product.id,
        reference: product.reference,
        name: product.name,
        defaultSupplierId: product.defaultSupplierId,
        defaultSupplierName: supplierById.get(product.defaultSupplierId)?.name ?? null,
        categoryId: product.categoryId,
        categoryName: categoryById.get(product.categoryId)?.name ?? null,
        purchasePrice: product.purchasePrice,
        salePrice: product.salePrice,
        taxRate: product.taxRate,
      })),
      suppliers: this.suppliersOf(organizationId).map(({ id, code, name, active }) => ({ id, code, name, active })),
      categories: this.state.categories.filter((category) => category.organizationId === organizationId),
      stockByProduct: new Map(products.map((product) => [product.id, this.state.stock[product.id] ?? 0])),
    };
  }

  store(organizationId: string, userId = "user-1"): ImportWriteStore {
    return {
      runLine: async (work) => {
        const draft: State = structuredClone(this.state);
        const result = await work(this.lineTx(draft, organizationId, userId));
        this.state = draft; // commit only if the whole line succeeded
        return result;
      },
      describeError: (error) => {
        const business = error as { status?: unknown; message?: unknown };
        return typeof business.status === "number" && typeof business.message === "string"
          ? { status: business.status, message: business.message }
          : null;
      },
    };
  }

  private lineTx(draft: State, organizationId: string, userId: string): ImportLineTx {
    return {
      findSupplierByCode: async (code) => {
        const supplier = draft.suppliers.find((row) => row.organizationId === organizationId && row.code === code);
        return supplier ? { id: supplier.id, active: supplier.active } : null;
      },
      createSupplier: async ({ code, name }) => {
        this.supplierInserts += 1;
        if (this.failSupplierCodes.has(code)) throw new Error("connection reset while inserting the supplier");
        if (draft.suppliers.some((row) => row.organizationId === organizationId && row.code === code)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["organizationId", "code"] } });
        }
        const supplier = { id: this.id("sup"), organizationId, code, name, active: true, createdByUserId: userId };
        draft.suppliers.push(supplier);
        return { id: supplier.id };
      },
      findCategoryByName: async (name) =>
        draft.categories.find((row) => row.organizationId === organizationId && row.name.toLowerCase() === name.toLowerCase()) ?? null,
      createCategory: async (name) => {
        const category = { id: this.id("cat"), organizationId, name };
        draft.categories.push(category);
        return { id: category.id };
      },
      createProduct: async (row, categoryId, supplierId) => {
        if (this.failProductReferences.has(row.reference)) throw new Error("product insert failed");
        const product = {
          id: this.id("prod"),
          organizationId,
          reference: row.reference,
          name: row.name,
          categoryId,
          defaultSupplierId: supplierId,
          purchasePrice: row.purchasePriceHT,
          salePrice: row.salePriceHT,
          taxRate: row.taxRate,
        };
        draft.products.push(product);
        return product.id;
      },
      updateProduct: async (productId, row, categoryId, supplierId) => {
        const product = draft.products.find((item) => item.id === productId && item.organizationId === organizationId);
        if (!product) throw Object.assign(new Error("Produit introuvable au moment de la mise à jour."), { status: 404 });
        Object.assign(product, {
          name: row.name,
          categoryId,
          defaultSupplierId: supplierId,
          purchasePrice: row.purchasePriceHT,
          salePrice: row.salePriceHT,
          taxRate: row.taxRate,
        });
        return productId;
      },
      syncStock: async (productId, target) => {
        const current = draft.stock[productId] ?? 0;
        if (current === target) return false;
        draft.stock[productId] = target;
        draft.movements += 1;
        return true;
      },
    };
  }
}

const ORG = "org-a";
const OTHER_ORG = "org-b";

function line(index: number, overrides: Partial<ProductImportRow> = {}): ProductImportRow {
  return {
    excelRow: index + 1,
    reference: `PRD-${String(index).padStart(4, "0")}`,
    supplierCode: "ACYL",
    name: `Produit ${index}`,
    categoryName: "Conserves",
    purchasePriceTTC: 54.89,
    salePriceTTC: 59.47,
    taxRate: 10,
    targetStock: 10 + index,
    ...overrides,
  };
}

/** The whole import as the routes run it: classify the file, send the importable lines in batches. */
async function importFile(db: FakeDb, file: ProductImportRow[], organizationId = ORG, batchSize = 200) {
  const { rows: classified } = classifyPreloadedRows(file, db.preload(organizationId));
  const importable = classified.filter((row) => isImportableStatus(row.status));
  const totals = { created: 0, updated: 0, unchanged: 0, errors: 0, conflicts: 0, suppliersCreated: 0, categoriesCreated: 0, movements: 0 };
  const results: { excelRow: number; status: string; message: string }[] = [];
  for (const batch of chunkRows(importable, batchSize)) {
    // each batch is re-classified from scratch by the write route
    const { rows } = classifyPreloadedRows(batch, db.preload(organizationId));
    const outcome = await writeImportBatch(db.store(organizationId), rows);
    totals.suppliersCreated += outcome.suppliersCreated;
    totals.categoriesCreated += outcome.categoriesCreated;
    totals.movements += outcome.stockMovementsCreated;
    for (const result of outcome.results) {
      results.push(result);
      if (result.status === "CREATED") totals.created += 1;
      else if (result.status === "UPDATED") totals.updated += 1;
      else if (result.status === "UNCHANGED") totals.unchanged += 1;
      else if (result.status === "CONFLICT") totals.conflicts += 1;
      else totals.errors += 1;
    }
  }
  return { classified, totals, results };
}

// ---- classification ------------------------------------------------------------------

test("classification: an unknown ref_fournisseur is no longer an error - the line is NEW and flagged supplierCreate", () => {
  const db = new FakeDb();
  db.addCategory(ORG, "Conserves");
  const { rows, summary } = classifyPreloadedRows([line(1)], db.preload(ORG));
  assert.deepEqual([rows[0].status, rows[0].supplierCreate, rows[0].supplierId], ["NEW", true, null]);
  assert.equal(summary.errors, 0);
  assert.equal(/introuvable/.test(rows[0].message), false);
});

test("classification: an existing supplier is reused as is; an inactive one is still refused (rule unchanged)", () => {
  const db = new FakeDb();
  const acyl = db.addSupplier(ORG, "ACYL");
  db.addSupplier(ORG, "OLD", false);
  const { rows } = classifyPreloadedRows([line(1), line(2, { supplierCode: "OLD" })], db.preload(ORG));
  assert.deepEqual([rows[0].status, rows[0].supplierCreate, rows[0].supplierId], ["NEW", false, acyl.id]);
  assert.deepEqual([rows[1].status, rows[1].message], ["ERROR", "Fournisseur inactif : OLD"]);
});

test("classification: an existing product moving to a supplier that does not exist yet is an UPDATE of its supplier", () => {
  const db = new FakeDb();
  const old = db.addSupplier(ORG, "OLD-SUP");
  const category = db.addCategory(ORG, "Conserves");
  const row = line(1, { supplierCode: "NEW-SUP" });
  db.state.products.push({
    id: "prod-x",
    organizationId: ORG,
    reference: row.reference,
    name: row.name,
    categoryId: category.id,
    defaultSupplierId: old.id,
    purchasePrice: computePriceHTFromTTC(row.purchasePriceTTC, row.taxRate),
    salePrice: computePriceHTFromTTC(row.salePriceTTC, row.taxRate),
    taxRate: row.taxRate,
  });
  db.state.stock["prod-x"] = row.targetStock;
  const [classified] = classifyPreloadedRows([row], db.preload(ORG)).rows;
  assert.equal(classified.status, "EXISTING_UPDATE");
  assert.equal(classified.supplierCreate, true);
  assert.deepEqual(classified.changes, { supplier: { old: "OLD-SUP", new: "NEW-SUP" } });
});

// ---- 1. existing supplier -> reused ------------------------------------------------------

test("1. an existing supplier (ACYL) is reused: no supplier is created, the product is linked to it", async () => {
  const db = new FakeDb();
  const acyl = db.addSupplier(ORG, "ACYL");
  const { totals } = await importFile(db, [line(1), line(2)]);
  assert.equal(totals.created, 2);
  assert.equal(totals.suppliersCreated, 0);
  assert.equal(db.supplierInserts, 0);
  assert.deepEqual(db.suppliersOf(ORG).map((supplier) => supplier.id), [acyl.id]);
  assert.ok(db.state.products.every((product) => product.defaultSupplierId === acyl.id));
});

// ---- 2. absent supplier -> created --------------------------------------------------------

test("2. ACYL does not exist: it is created (code = name = ACYL, active, created by the importing user) and the product linked to it", async () => {
  const db = new FakeDb();
  const { totals, results } = await importFile(db, [line(1)]);
  assert.deepEqual(results.map((result) => result.status), ["CREATED"]);
  assert.equal(totals.suppliersCreated, 1);
  const [acyl] = db.suppliersOf(ORG);
  assert.deepEqual(
    { code: acyl.code, name: acyl.name, active: acyl.active, organizationId: acyl.organizationId, createdByUserId: acyl.createdByUserId },
    { code: "ACYL", name: "ACYL", active: true, organizationId: ORG, createdByUserId: "user-1" },
  );
  assert.equal(db.state.products[0].defaultSupplierId, acyl.id);
  // the rest of the line is unchanged: category created, stock target written
  assert.equal(totals.categoriesCreated, 1);
  assert.equal(db.state.stock[db.state.products[0].id], 11);
});

// ---- 3. second import -> no duplicate ------------------------------------------------------

test("3. importing the same file a second time: ACYL is the same supplier, nothing is created twice", async () => {
  const db = new FakeDb();
  const file = [line(1), line(2), line(3, { supplierCode: "BETA" })];
  const first = await importFile(db, file);
  assert.equal(first.totals.suppliersCreated, 2);
  const suppliersAfterFirst = structuredClone(db.suppliersOf(ORG));

  const second = await importFile(db, file);
  assert.equal(second.classified.filter((row) => row.supplierCreate).length, 0, "the second classification finds both suppliers");
  assert.deepEqual(second.classified.map((row) => row.status), ["EXISTING_UNCHANGED", "EXISTING_UNCHANGED", "EXISTING_UNCHANGED"]);
  assert.equal(second.totals.suppliersCreated, 0);
  assert.deepEqual(db.suppliersOf(ORG), suppliersAfterFirst);
  assert.equal(db.suppliersOf(ORG).filter((supplier) => supplier.code === "ACYL").length, 1);
});

// ---- 4. ten lines, one new supplier -> one creation -----------------------------------

test("4. ten lines with the same new supplier create it ONCE; the nine others reuse it", async () => {
  const db = new FakeDb();
  const file = Array.from({ length: 10 }, (_, index) => line(index + 1));
  const { classified, totals } = await importFile(db, file);
  assert.equal(classified.filter((row) => row.supplierCreate).length, 10, "all ten lines were classified 'to create'");
  assert.equal(totals.created, 10);
  assert.equal(totals.suppliersCreated, 1);
  assert.equal(db.supplierInserts, 1);
  const [acyl] = db.suppliersOf(ORG);
  assert.ok(db.state.products.every((product) => product.defaultSupplierId === acyl.id));
});

test("4b. the same holds across batches: the next batch finds the supplier the previous one created", async () => {
  const db = new FakeDb();
  const file = Array.from({ length: 10 }, (_, index) => line(index + 1));
  const { totals } = await importFile(db, file, ORG, 3); // 4 batches: 3 + 3 + 3 + 1
  assert.equal(totals.suppliersCreated, 1);
  assert.equal(db.suppliersOf(ORG).length, 1);
  assert.equal(totals.created, 10);
});

// ---- 5. several new suppliers -> each created once ------------------------------------

test("5. several new suppliers, interleaved: each one is created exactly once, and the total is global", async () => {
  const db = new FakeDb();
  const codes = ["ACYL", "BETA", "GAMMA"];
  const file = Array.from({ length: 12 }, (_, index) => line(index + 1, { supplierCode: codes[index % 3] }));
  const { totals } = await importFile(db, file, ORG, 5);
  assert.equal(totals.suppliersCreated, 3);
  assert.deepEqual(db.suppliersOf(ORG).map((supplier) => supplier.code).sort(), codes);
  for (const code of codes) {
    const supplier = db.suppliersOf(ORG).find((item) => item.code === code)!;
    assert.equal(db.state.products.filter((product) => product.defaultSupplierId === supplier.id).length, 4, code);
  }
});

// ---- 6. supplier creation fails -> only that line is in error ------------------------------

test("6. the creation of one supplier fails: its lines are in ERROR, rolled back, and every other line is imported", async () => {
  const db = new FakeDb();
  db.failSupplierCodes.add("BROKEN");
  const file = [line(1), line(2, { supplierCode: "BROKEN" }), line(3), line(4, { supplierCode: "BROKEN" }), line(5, { supplierCode: "BETA" })];
  const { totals, results } = await importFile(db, file);
  assert.deepEqual(results.map((result) => result.status), ["CREATED", "ERROR", "CREATED", "ERROR", "CREATED"]);
  assert.equal(results[1].message, "Import impossible pour cette ligne.");
  assert.equal(totals.suppliersCreated, 2, "ACYL and BETA");
  // nothing of the failed lines was written: no product, no supplier, no stock
  assert.equal(db.state.products.some((product) => product.reference === "PRD-0002" || product.reference === "PRD-0004"), false);
  assert.equal(db.suppliersOf(ORG).some((supplier) => supplier.code === "BROKEN"), false);
  assert.equal(db.state.products.length, 3);
});

test("6b. a line that fails AFTER creating its supplier is rolled back whole; the next line creates the supplier, once", async () => {
  const db = new FakeDb();
  db.failProductReferences.add("PRD-0001");
  const { totals, results } = await importFile(db, [line(1), line(2), line(3)]);
  assert.deepEqual(results.map((result) => result.status), ["ERROR", "CREATED", "CREATED"]);
  assert.equal(totals.suppliersCreated, 1, "counted once, for the line that committed");
  assert.equal(db.suppliersOf(ORG).length, 1);
});

test("6c. a supplier created meanwhile by someone else is found by the re-check inside the line, not created twice", async () => {
  const db = new FakeDb();
  const { rows } = classifyPreloadedRows([line(1)], db.preload(ORG)); // classified 'to create'
  const concurrent = db.addSupplier(ORG, "ACYL"); // created between the classification and the write
  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.deepEqual([outcome.results[0].status, outcome.suppliersCreated], ["CREATED", 0]);
  assert.equal(db.suppliersOf(ORG).length, 1);
  assert.equal(db.state.products[0].defaultSupplierId, concurrent.id);
});

test("6d. a supplier deactivated meanwhile is refused for that line only", async () => {
  const db = new FakeDb();
  const { rows } = classifyPreloadedRows([line(1), line(2, { supplierCode: "BETA" })], db.preload(ORG));
  db.addSupplier(ORG, "ACYL", false);
  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.deepEqual(outcome.results.map((result) => [result.status, result.message]), [
    ["ERROR", "Fournisseur inactif : ACYL"],
    ["CREATED", "Produit créé."],
  ]);
});

// ---- 7. organizationId ----------------------------------------------------------------------

test("7. multi-tenant: ACYL of another organisation is neither reused nor touched - this organisation gets its own", async () => {
  const db = new FakeDb();
  const foreign = db.addSupplier(OTHER_ORG, "ACYL");
  const { totals } = await importFile(db, [line(1), line(2)], ORG);
  assert.equal(totals.suppliersCreated, 1);
  const own = db.suppliersOf(ORG);
  assert.equal(own.length, 1);
  assert.notEqual(own[0].id, foreign.id);
  assert.equal(own[0].organizationId, ORG);
  assert.ok(db.state.products.every((product) => product.organizationId === ORG && product.defaultSupplierId === own[0].id));
  assert.deepEqual(db.suppliersOf(OTHER_ORG), [foreign]);
});

test("7b. the Prisma store scopes every supplier query and creation to the session's organisation", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/server/products-import-apply.ts"), "utf8");
  assert.match(source, /tx\.supplier\.findFirst\(\{\s*where: \{ organizationId, code \},/);
  assert.match(source, /tx\.supplier\.create\(\{\s*data: \{ organizationId, code, name, active: true, createdByUserId: userId \},/);
  // the organisation always comes from the session (requireOrganizationUser), never from the file
  const route = readFileSync(path.join(process.cwd(), "app/api/produits/import/route.ts"), "utf8");
  assert.match(route, /organizationId: user\.organizationId,/);
  // one Serializable transaction per line, as before
  assert.match(source, /prisma\.\$transaction\(\(tx\) => work\(lineTx\(tx, organizationId, userId, locationId\)\), \{\s*isolationLevel: "Serializable",/);
  // no accounting side effect at import time
  assert.equal(/accountingAccount|resolveOrCreateAccountingLink/.test(source), false);
});

// ---- 8. idempotence -----------------------------------------------------------------------

test("8. idempotent: the same mixed file imported three times leaves exactly the state of the first import", async () => {
  const db = new FakeDb();
  db.addSupplier(ORG, "ACYL");
  const file = [
    ...Array.from({ length: 6 }, (_, index) => line(index + 1, { supplierCode: index % 2 ? "NEW-1" : "ACYL" })),
    ...Array.from({ length: 4 }, (_, index) => line(index + 7, { supplierCode: "NEW-2" })),
  ];
  const first = await importFile(db, file, ORG, 4);
  assert.equal(first.totals.suppliersCreated, 2);
  assert.equal(first.totals.created, 10);
  const snapshot = structuredClone(db.state);

  for (let run = 0; run < 2; run += 1) {
    const again = await importFile(db, file, ORG, 4);
    assert.deepEqual(
      [again.totals.created, again.totals.updated, again.totals.suppliersCreated, again.totals.categoriesCreated, again.totals.movements],
      [0, 0, 0, 0, 0],
    );
    assert.deepEqual(db.state, snapshot);
  }
});

test("the stock, category, price and movement rules are untouched by the supplier creation", async () => {
  const db = new FakeDb();
  const { totals } = await importFile(db, [line(1, { categoryName: "Jus" }), line(2, { categoryName: "JUS" }), line(3, { targetStock: 0 })]);
  assert.equal(totals.categoriesCreated, 2, "'Jus' and 'JUS' are one category, plus 'Conserves'");
  assert.equal(totals.movements, 2, "a target of 0 on a new product writes no movement");
  const product = db.state.products[0];
  assert.equal(product.purchasePrice, computePriceHTFromTTC(54.89, 10));
  assert.equal(product.salePrice, computePriceHTFromTTC(59.47, 10));
});

test("the classified rows the writer gets carry the supplier decision; nothing else is new", () => {
  const keys: (keyof ClassifiedProductRow)[] = ["supplierId", "supplierName", "supplierCreate", "categoryId", "categoryCreate"];
  const [row] = classifyPreloadedRows([line(1)], new FakeDb().preload(ORG)).rows;
  for (const key of keys) assert.ok(key in row, key);
});
