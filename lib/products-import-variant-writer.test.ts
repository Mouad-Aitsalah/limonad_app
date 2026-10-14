import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProductGrid } from "@/lib/import-export/products-format";
import {
  classifyPreloadedRows,
  productImportRowSchema,
  type ClassifiedProductRow,
  type ProductImportPreload,
  type ProductImportRow,
} from "@/lib/products-import-rules";
import { isImportableStatus } from "@/lib/products-import-shared";
import { finalizeVariantGroups, prepareVariantRows } from "@/lib/products-import-variant-groups";
import { withVariantGroupSizes } from "@/lib/products-import-variant-ui";
import { writeImportBatch, type ImportLineTx, type ImportWriteStore } from "@/lib/products-import-writer";

/**
 * The write of variants groups against an in-memory database that has the guarantees the
 * real one has: a transaction (a draft that is committed only when the work succeeds), unique
 * references / barcodes (P2002), foreign keys (a product needs an EXISTING category), stock per
 * location, a serialization failure that makes the store replay the group. No Prisma client.
 */

const ORG = "org-a";
const OTHER_ORG = "org-b";
const DEPOT = "depot-a";
const OTHER_DEPOT = "depot-b";

type Product = { id: string; organizationId: string; reference: string; barcode: string | null; name: string; categoryId: string; supplierId: string; purchasePrice: number; salePrice: number; taxRate: number };
type State = {
  suppliers: Array<{ id: string; organizationId: string; code: string; name: string; active: boolean }>;
  categories: Array<{ id: string; organizationId: string; name: string }>;
  products: Product[];
  stock: Record<string, number>; // `${productId}@${locationId}`
  movements: Array<{ productId: string; locationId: string; delta: number; number: number }>;
  movementCounter: number;
};

class FakeDb {
  state: State = { suppliers: [], categories: [], products: [], stock: {}, movements: [], movementCounter: 0 };
  private sequence = 0;
  calls = { runLine: 0, runGroup: 0, attempts: 0 };
  /** createProduct throws a plain database error for these references. */
  failOnReference = new Set<string>();
  /** createProduct throws P2034 (serialization failure) this many times in total. */
  serializationFailures = 0;
  /** P2028 (transaction timed out) at this reference. */
  timeoutOnReference: string | null = null;
  /** An unrelated writer commits this product right before the next group transaction starts. */
  concurrentProduct: Product | null = null;

  id(prefix: string) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  seedSupplier(organizationId: string, code = "F1") {
    const supplier = { id: this.id("sup"), organizationId, code, name: `Fournisseur ${code}`, active: true };
    this.state.suppliers.push(supplier);
    return supplier;
  }

  seedCategory(organizationId: string, name: string) {
    const category = { id: this.id("cat"), organizationId, name };
    this.state.categories.push(category);
    return category;
  }

  seedProduct(organizationId: string, over: Partial<Product> & Pick<Product, "reference" | "name" | "categoryId">, stock: Record<string, number> = {}) {
    const product: Product = {
      id: this.id("prod"),
      organizationId,
      barcode: null,
      supplierId: this.state.suppliers.find((supplier) => supplier.organizationId === organizationId)?.id ?? "",
      purchasePrice: 10,
      salePrice: 12,
      taxRate: 20,
      ...over,
    };
    this.state.products.push(product);
    for (const [location, quantity] of Object.entries(stock)) this.state.stock[`${product.id}@${location}`] = quantity;
    return product;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  stockOf(productId: string, location = DEPOT) {
    return this.state.stock[`${productId}@${location}`];
  }

  preload(organizationId: string, location = DEPOT): ProductImportPreload {
    const supplierById = new Map(this.state.suppliers.map((supplier) => [supplier.id, supplier]));
    const categoryById = new Map(this.state.categories.map((category) => [category.id, category]));
    const products = this.state.products.filter((product) => product.organizationId === organizationId);
    return {
      products: products.map((product) => ({
        id: product.id,
        reference: product.reference,
        name: product.name,
        defaultSupplierId: product.supplierId,
        defaultSupplierName: supplierById.get(product.supplierId)?.name ?? null,
        categoryId: product.categoryId,
        categoryName: categoryById.get(product.categoryId)?.name ?? null,
        purchasePrice: product.purchasePrice,
        salePrice: product.salePrice,
        taxRate: product.taxRate,
        barcode: product.barcode,
      })),
      suppliers: this.state.suppliers.filter((supplier) => supplier.organizationId === organizationId),
      categories: this.state.categories.filter((category) => category.organizationId === organizationId),
      barcodeOwners: new Map(products.flatMap((product) => (product.barcode ? [[product.barcode, product.reference] as [string, string]] : []))),
      stockByProduct: new Map(products.map((product) => [product.id, this.state.stock[`${product.id}@${location}`] ?? 0])),
    };
  }

  store(organizationId: string, location = DEPOT, options: { groups?: boolean } = {}): ImportWriteStore {
    const describeError = (error: unknown) => {
      const business = error as { status?: unknown; message?: unknown };
      return typeof business.status === "number" && typeof business.message === "string" ? { status: business.status, message: business.message } : null;
    };
    const store: ImportWriteStore = {
      runLine: async (work) => {
        this.calls.runLine += 1;
        const draft = structuredClone(this.state);
        const result = await work(this.tx(draft, organizationId, location));
        this.state = draft;
        return result;
      },
      describeError,
    };
    if (options.groups !== false) {
      // like the real store: one Serializable transaction for the group, replayed on a serialization failure
      store.runGroup = async (work) => {
        this.calls.runGroup += 1;
        for (let attempt = 1; ; attempt += 1) {
          this.calls.attempts += 1;
          if (this.concurrentProduct) {
            this.state.products.push(this.concurrentProduct);
            this.concurrentProduct = null;
          }
          const draft = structuredClone(this.state);
          try {
            const result = await work(this.tx(draft, organizationId, location));
            this.state = draft;
            return result;
          } catch (error) {
            if ((error as { code?: string }).code === "P2034" && attempt < 4) continue;
            throw error;
          }
        }
      };
    }
    return store;
  }

  private tx(draft: State, organizationId: string, location: string): ImportLineTx {
    return {
      findSupplierByCode: async (code) => {
        const supplier = draft.suppliers.find((row) => row.organizationId === organizationId && row.code === code);
        return supplier ? { id: supplier.id, active: supplier.active } : null;
      },
      createSupplier: async ({ code, name }) => {
        const supplier = { id: this.id("sup"), organizationId, code, name, active: true };
        draft.suppliers.push(supplier);
        return { id: supplier.id };
      },
      findCategoryByName: async (name) => draft.categories.find((row) => row.organizationId === organizationId && row.name.toLowerCase() === name.toLowerCase()) ?? null,
      createCategory: async (name) => {
        const category = { id: this.id("cat"), organizationId, name };
        draft.categories.push(category);
        return { id: category.id };
      },
      findBrandByName: async () => null,
      createBrand: async (name) => ({ id: this.id(`brand-${name}`) }),
      createProduct: async (row, categoryId, supplierId) => {
        if (this.serializationFailures > 0) {
          this.serializationFailures -= 1;
          throw Object.assign(new Error("could not serialize access"), { code: "P2034" });
        }
        if (this.timeoutOnReference === row.reference) throw Object.assign(new Error("Transaction already closed"), { code: "P2028" });
        if (this.failOnReference.has(row.reference)) throw new Error("product insert failed");
        // foreign key: the category must exist in THIS transaction
        if (!draft.categories.some((category) => category.id === categoryId)) throw new Error("foreign key violation: category " + categoryId);
        if (draft.products.some((product) => product.organizationId === organizationId && product.reference === row.reference)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["organizationId", "reference"] } });
        }
        if (row.barcode && draft.products.some((product) => product.organizationId === organizationId && product.barcode === row.barcode)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["organizationId", "barcode"] } });
        }
        const product: Product = {
          id: this.id("prod"),
          organizationId,
          reference: row.reference,
          barcode: row.barcode ?? null,
          name: row.name!,
          categoryId,
          supplierId,
          purchasePrice: row.purchasePriceHT!,
          salePrice: row.salePriceHT!,
          taxRate: row.taxRate!,
        };
        draft.products.push(product);
        return product.id;
      },
      updateProduct: async (productId, row, categoryId, supplierId) => {
        const product = draft.products.find((item) => item.id === productId && item.organizationId === organizationId);
        if (!product) throw Object.assign(new Error("Produit introuvable au moment de la mise à jour."), { status: 404 });
        Object.assign(product, {
          ...(row.name !== undefined ? { name: row.name } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(supplierId ? { supplierId } : {}),
          ...(row.purchasePriceHT !== undefined ? { purchasePrice: row.purchasePriceHT } : {}),
          ...(row.salePriceHT !== undefined ? { salePrice: row.salePriceHT } : {}),
          ...(row.taxRate !== undefined ? { taxRate: row.taxRate } : {}),
        });
        return productId;
      },
      // stock is a TARGET at THIS depot only; no movement when it already is the target
      syncStock: async (productId, target) => {
        const key = `${productId}@${location}`;
        const current = draft.stock[key] ?? 0;
        if (current === target) {
          draft.stock[key] = current;
          return false;
        }
        draft.stock[key] = target;
        draft.movementCounter += 1;
        draft.movements.push({ productId, locationId: location, delta: target - current, number: draft.movementCounter });
        return true;
      },
    };
  }
}

// ---- the pipeline, as the write route will run it ---------------------------------------------------

const cells = (parent: string, attrs: string, over: Partial<Record<number, unknown>> = {}) => {
  const row: unknown[] = [parent, "", "Sport", 100, 150, 5, attrs];
  for (const [index, value] of Object.entries(over)) row[Number(index)] = value;
  return row;
};

/** The lines the browser sends: parsed, locally valid ones only, each with the size of its file group. */
function sentRows(grid: unknown[][]): ProductImportRow[] {
  const parsed = parseProductGrid(grid);
  assert.equal(parsed.fatal, undefined);
  const local = parsed.lines.map(({ line, errors }) => ({ values: line, status: errors.length ? ("ERROR" as const) : ("VALID" as const), message: errors.join(" ; ") }));
  const valid = local.filter((row) => row.status === "VALID").map((row) => row.values);
  return withVariantGroupSizes(valid, local).map((line) => productImportRowSchema.parse(line));
}

/** What the write route does with a batch: classify from scratch (groups included), then write. */
function classify(db: FakeDb, rows: ProductImportRow[], options: { applyStock?: boolean; organizationId?: string; location?: string } = {}): ClassifiedProductRow[] {
  const prepared = prepareVariantRows(rows);
  const classified = classifyPreloadedRows(prepared.rows, db.preload(options.organizationId ?? ORG, options.location ?? DEPOT), {
    applyStock: options.applyStock ?? true,
    creationDefaults: { supplierCode: "F1", taxRate: 20 },
  });
  return finalizeVariantGroups(classified, { problems: prepared.problems, requireGroupSize: true }).rows;
}

function fixture() {
  const db = new FakeDb();
  db.seedSupplier(ORG, "F1");
  db.seedSupplier(OTHER_ORG, "F1");
  return db;
}

const ARSENAL = [cells("Arsenal", "TAILLE: S | COULEUR: NOIR"), cells("Arsenal", "TAILLE: M | COULEUR: NOIR"), cells("Arsenal", "TAILLE: L | COULEUR: NOIR")];
const SHORT = [cells("Short Nike", "TAILLE: S"), cells("Short Nike", "TAILLE: M")];

// ---- a group is one transaction ------------------------------------------------------------------------

test("a clean group is written in ONE transaction: products, stock targets, one movement each, category created once", async () => {
  const db = fixture();
  const rows = classify(db, sentRows(ARSENAL));
  assert.deepEqual(rows.map((row) => row.status), ["NEW", "NEW", "NEW"]);

  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.deepEqual(outcome.results.map((result) => result.status), ["CREATED", "CREATED", "CREATED"]);
  assert.deepEqual(db.calls, { runLine: 0, runGroup: 1, attempts: 1 }, "one transaction for the three variants, no per-line transaction");
  assert.equal(db.state.products.length, 3);
  assert.equal(db.state.categories.length, 1);
  assert.equal(outcome.categoriesCreated, 1);
  assert.equal(outcome.stockMovementsCreated, 3);
  assert.deepEqual(db.state.products.map((product) => db.stockOf(product.id)), [5, 5, 5], "the file's stock is the TARGET, not an addition");
  assert.deepEqual(db.state.movements.map((movement) => movement.delta), [5, 5, 5]);
  assert.deepEqual([outcome.groupsWritten, outcome.groupsRolledBack, outcome.groupsRefused], [1, 0, 0]);
  assert.deepEqual(outcome.deferred, []);
});

test("a failure on the THIRD line rolls the WHOLE group back: nothing of the first two survives", async () => {
  const db = fixture();
  const rows = classify(db, sentRows(ARSENAL));
  db.failOnReference.add(rows[2].reference);
  const before = db.snapshot();

  const outcome = await writeImportBatch(db.store(ORG), rows);

  assert.deepEqual(db.state, before, "products, categories, suppliers, stock levels and movements are exactly as before");
  assert.deepEqual(outcome.results.map((result) => result.status), ["ERROR", "ERROR", "ERROR"]);
  assert.match(outcome.results[0].message, /^Groupe annulé : la ligne 3 a échoué - aucune variante du groupe n'a été écrite\./);
  assert.match(outcome.results[1].message, /^Groupe annulé : la ligne 3 a échoué/);
  assert.equal(outcome.results[2].message, "Import impossible pour cette ligne.", "the failing line keeps its own error");
  assert.deepEqual(
    [outcome.categoriesCreated, outcome.suppliersCreated, outcome.brandsCreated, outcome.stockMovementsCreated],
    [0, 0, 0, 0],
    "no counter keeps the effect of the rolled-back transaction",
  );
  assert.deepEqual([outcome.groupsWritten, outcome.groupsRolledBack, outcome.groupsRefused], [0, 1, 0]);
});

test("the caches learn nothing from a rolled-back group: the next group re-creates what the failed one had created", async () => {
  const db = fixture();
  // the first group FAILS on its third line after having created the category "Sport" inside its transaction;
  // the second group (same category) must then create it itself - a stale cached id would break its foreign key
  const first = [...ARSENAL];
  const second = [...SHORT];
  const rows = classify(db, sentRows([...first, ...second]));
  db.failOnReference.add(rows[2].reference);

  const outcome = await writeImportBatch(db.store(ORG), rows);

  assert.deepEqual(outcome.results.map((result) => result.status), ["ERROR", "ERROR", "ERROR", "CREATED", "CREATED"]);
  assert.equal(db.state.categories.length, 1, "one category, created by the group that committed");
  assert.equal(db.state.products.length, 2);
  assert.equal(outcome.categoriesCreated, 1, "counted once: only the committed creation");
  assert.equal(outcome.stockMovementsCreated, 2);
  assert.deepEqual([outcome.groupsWritten, outcome.groupsRolledBack], [1, 1]);
});

test("a COMMITTED group lets the next one reuse its category (created once for the whole batch)", async () => {
  const db = fixture();
  const rows = classify(db, sentRows([...ARSENAL, ...SHORT]));
  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.equal(db.state.categories.length, 1);
  assert.equal(outcome.categoriesCreated, 1);
  assert.equal(db.calls.runGroup, 2);
  assert.equal(db.state.products.length, 5);
});

test("a barcode that another product holds (raced after the preview) rolls the group back and says which line", async () => {
  const db = fixture();
  const rows = classify(db, sentRows([cells("Short", "TAILLE: S"), cells("Short", "TAILLE: M"), cells("Short", "TAILLE: L", { 1: "611777" })]));
  const category = db.seedCategory(ORG, "Autre");
  // somebody else takes the barcode after the preview classified the file
  db.state.products.push({ id: "p-x", organizationId: ORG, reference: "AUTRE", barcode: "611777", name: "Autre", categoryId: category.id, supplierId: "", purchasePrice: 1, salePrice: 1, taxRate: 20 });
  const before = db.snapshot();

  const outcome = await writeImportBatch(db.store(ORG), rows);

  assert.deepEqual(db.state, before);
  assert.deepEqual(outcome.results.map((result) => result.status), ["ERROR", "ERROR", "CONFLICT"]);
  assert.equal(outcome.results[2].message, "Code-barres déjà utilisé par un autre produit.");
});

test("inside a group a reference conflict is a CONFLICT to preview again - never the lone line's « Produit déjà présent »", async () => {
  const db = fixture();
  const rows = classify(db, sentRows(ARSENAL));
  const category = db.seedCategory(ORG, "Sport");
  // another import wrote the SECOND variant between the preview and now
  db.concurrentProduct = { id: "p-race", organizationId: ORG, reference: rows[1].reference, barcode: null, name: "x", categoryId: category.id, supplierId: "", purchasePrice: 1, salePrice: 1, taxRate: 20 };

  const outcome = await writeImportBatch(db.store(ORG), rows);

  assert.deepEqual(outcome.results.map((result) => result.status), ["ERROR", "CONFLICT", "ERROR"]);
  assert.match(outcome.results[1].message, /relancez l'aperçu/);
  assert.equal(db.state.products.length, 1, "only the product the OTHER import wrote; none of this group");
  assert.equal(db.state.movements.length, 0);
});

// ---- serialization failures and timeouts: the store replays the whole group ------------------------

test("a serialization failure in the middle replays the group from scratch: written once, no duplicate, caches from the successful attempt only", async () => {
  const db = fixture();
  const rows = classify(db, sentRows(ARSENAL));
  db.serializationFailures = 2; // the first two attempts die on the first insert

  const outcome = await writeImportBatch(db.store(ORG), rows);

  assert.equal(db.calls.attempts, 3);
  assert.deepEqual(outcome.results.map((result) => result.status), ["CREATED", "CREATED", "CREATED"]);
  assert.equal(db.state.products.length, 3);
  assert.equal(db.state.categories.length, 1);
  assert.equal(outcome.categoriesCreated, 1);
  assert.equal(outcome.stockMovementsCreated, 3);
  assert.equal(db.state.movementCounter, 3, "the movement numbers of the failed attempts were given back");
});

test("a serialization failure that never ends, or a timeout, is blamed on the TRANSACTION, not on a line - and nothing is written", async () => {
  const db = fixture();
  const rows = classify(db, sentRows(ARSENAL));
  db.serializationFailures = 99;
  const before = db.snapshot();
  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.deepEqual(db.state, before);
  assert.ok(outcome.results.every((result) => result.status === "ERROR" && /^Groupe annulé \(conflit d'accès concurrent/.test(result.message)));
  assert.equal(outcome.categoriesCreated, 0);

  const timed = fixture();
  const timedRows = classify(timed, sentRows(ARSENAL));
  timed.timeoutOnReference = timedRows[1].reference;
  const timedBefore = timed.snapshot();
  const timedOutcome = await writeImportBatch(timed.store(ORG), timedRows);
  assert.deepEqual(timed.state, timedBefore);
  assert.ok(timedOutcome.results.every((result) => /^Groupe annulé \(la transaction a dépassé son délai\)/.test(result.message)));
});

// ---- refused before any transaction ------------------------------------------------------------------

test("a blocked group never opens a transaction: every line says why", async () => {
  const db = fixture();
  const rows = classify(db, sentRows([...ARSENAL.slice(0, 2), cells("Arsenal", "TAILLE: L | COULEUR: NOIR", { 3: "abc" })]));
  // the third line is invalid in the browser, so only two lines are sent while the file's group has three
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.status === "ERROR" && /Groupe incomplet : 2 ligne\(s\) reçue\(s\) sur 3/.test(row.message)));

  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.deepEqual(db.calls, { runLine: 0, runGroup: 0, attempts: 0 });
  assert.equal(db.state.products.length, 0);
  assert.deepEqual([outcome.groupsWritten, outcome.groupsRolledBack, outcome.groupsRefused], [0, 0, 1]);
});

test("a store that cannot write groups refuses them; ordinary lines of the same batch are still written", async () => {
  const db = fixture();
  const ordinary = productImportRowSchema.parse({ excelRow: 90, reference: "P-90", name: "Eau", categoryName: "Sport", supplierCode: "F1", purchasePriceTTC: 5, salePriceTTC: 6, taxRate: 20, targetStock: 3 });
  const rows = [...classify(db, sentRows(ARSENAL)), ...classifyPreloadedRows([ordinary], db.preload(ORG)).rows];
  const outcome = await writeImportBatch(db.store(ORG, DEPOT, { groups: false }), rows);
  assert.deepEqual(outcome.results.map((result) => result.status), ["ERROR", "ERROR", "ERROR", "CREATED"]);
  assert.match(outcome.results[0].message, /Écriture atomique par groupe indisponible/);
  assert.deepEqual(db.state.products.map((product) => product.reference), ["P-90"]);
});

test("a group that cannot be written (no such supplier) is refused whole before the transaction", async () => {
  const db = fixture();
  const rows = classify(db, sentRows(ARSENAL));
  rows[1] = { ...rows[1], supplierId: null, supplierCreate: false };
  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.equal(db.calls.runGroup, 0);
  assert.deepEqual(outcome.results.map((result) => result.status), ["ERROR", "ERROR", "ERROR"]);
  assert.match(outcome.results[1].message, /^Fournisseur introuvable/);
  assert.match(outcome.results[0].message, /^Groupe refusé : la ligne 2/);
});

// ---- stock, idempotence, isolation ------------------------------------------------------------------

test("re-importing the same file writes nothing: no transaction, no movement, no movement number consumed", async () => {
  const db = fixture();
  await writeImportBatch(db.store(ORG), classify(db, sentRows([...ARSENAL, ...SHORT])));
  const afterFirst = db.snapshot();
  const callsAfterFirst = { ...db.calls };

  const second = classify(db, sentRows([...ARSENAL, ...SHORT]));
  assert.ok(second.every((row) => row.status === "EXISTING_UNCHANGED"), "every variant is found again by its derived reference");
  assert.equal(second.filter((row) => isImportableStatus(row.status)).length, 0, "nothing is even sent to the write");
  const outcome = await writeImportBatch(db.store(ORG), second);

  assert.deepEqual(outcome.results.map((result) => result.status), Array(5).fill("UNCHANGED"));
  assert.deepEqual(db.state, afterFirst);
  assert.deepEqual(db.calls, callsAfterFirst, "not one more transaction");
  assert.equal(outcome.stockMovementsCreated, 0);
});

test("stock stays a TARGET: a re-import with a changed price keeps the stock, a changed stock writes ONE movement of the difference", async () => {
  const db = fixture();
  await writeImportBatch(db.store(ORG), classify(db, sentRows(SHORT)));
  const stocks = () => db.state.products.map((product) => db.stockOf(product.id));
  assert.deepEqual(stocks(), [5, 5]);

  // same stock (5), new price: updated, stock untouched, no movement
  const priceOnly = classify(db, sentRows([cells("Short Nike", "TAILLE: S", { 4: 180 }), cells("Short Nike", "TAILLE: M")]));
  assert.deepEqual(priceOnly.map((row) => row.status), ["EXISTING_UPDATE", "EXISTING_UNCHANGED"]);
  const movementsBefore = db.state.movements.length;
  const outcome = await writeImportBatch(db.store(ORG), priceOnly);
  assert.deepEqual(outcome.results.map((result) => result.status), ["UPDATED", "UNCHANGED"]);
  assert.equal(db.state.movements.length, movementsBefore);
  assert.deepEqual(stocks(), [5, 5]);

  // file says 8 and 2: the TARGET becomes 8 and 2 (+3 and -3), never 5+8
  const target = classify(db, sentRows([cells("Short Nike", "TAILLE: S", { 5: 8 }), cells("Short Nike", "TAILLE: M", { 5: 2 })]));
  await writeImportBatch(db.store(ORG), target);
  assert.deepEqual(stocks(), [8, 2]);
  assert.deepEqual(db.state.movements.slice(movementsBefore).map((movement) => movement.delta), [3, -3]);
});

test("only the importer's depot is touched: another depot's stock of the same product and another organisation's products stay as they were", async () => {
  const db = fixture();
  const category = db.seedCategory(ORG, "Sport");
  const written = classify(db, sentRows(SHORT));
  // the second variant already exists, with stock elsewhere
  const existing = db.seedProduct(ORG, { reference: written[1].reference, name: written[1].name!, categoryId: category.id }, { [DEPOT]: 1, [OTHER_DEPOT]: 40 });
  const foreignCategory = db.seedCategory(OTHER_ORG, "Sport");
  const foreign = db.seedProduct(OTHER_ORG, { reference: written[1].reference, name: "Même référence, autre organisation", categoryId: foreignCategory.id }, { [DEPOT]: 7 });
  const foreignBefore = structuredClone(db.state.products.find((product) => product.id === foreign.id));

  const rows = classify(db, sentRows(SHORT));
  await writeImportBatch(db.store(ORG, DEPOT), rows);

  assert.equal(db.stockOf(existing.id, DEPOT), 5, "the importer's depot is brought to the target");
  assert.equal(db.stockOf(existing.id, OTHER_DEPOT), 40, "another depot is never touched");
  assert.equal(db.state.movements.every((movement) => movement.locationId === DEPOT), true);
  assert.deepEqual(db.state.products.find((product) => product.id === foreign.id), foreignBefore);
  assert.equal(db.stockOf(foreign.id, DEPOT), 7);
});

// ---- whole groups only, also at the deadline ---------------------------------------------------------

test("past the time budget the server hands back WHOLE groups - never some lines of one", async () => {
  const db = fixture();
  const rows = classify(db, sentRows([...ARSENAL, ...SHORT, cells("Ballon", "")]));
  let clock = 0;
  const outcome = await writeImportBatch(db.store(ORG), rows, { budgetMs: 100, now: () => (clock += 150) });
  // the first unit always runs; by the time the second would start the budget is spent
  assert.deepEqual(outcome.results.map((result) => result.excelRow), [1, 2, 3]);
  assert.deepEqual(outcome.deferred, [4, 5, 6], "the whole second group and the ordinary line after it");
  assert.equal(db.state.products.length, 3);
});

test("a mixed batch keeps ordinary lines line by line (their own transaction) and groups as units", async () => {
  const db = fixture();
  const ordinary = productImportRowSchema.parse({ excelRow: 90, reference: "P-90", name: "Eau", categoryName: "Sport", supplierCode: "F1", purchasePriceTTC: 5, salePriceTTC: 6, taxRate: 20 });
  const rows = [...classifyPreloadedRows([ordinary], db.preload(ORG)).rows, ...classify(db, sentRows(SHORT))];
  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.deepEqual(outcome.results.map((result) => result.status), ["CREATED", "CREATED", "CREATED"]);
  assert.deepEqual(db.calls, { runLine: 1, runGroup: 1, attempts: 1 });
});

test("the historical writer is untouched: no group fields, no group transaction, same counters", async () => {
  const db = fixture();
  const rows = classifyPreloadedRows(
    [1, 2, 3].map((index) => productImportRowSchema.parse({ excelRow: index + 1, reference: `P-${index}`, name: `Produit ${index}`, categoryName: "Conserves", supplierCode: "F1", purchasePriceTTC: 5, salePriceTTC: 6, taxRate: 20, targetStock: index })),
    db.preload(ORG),
  ).rows;
  assert.ok(rows.every((row) => row.variantGroupIndex === undefined));
  const outcome = await writeImportBatch(db.store(ORG), rows);
  assert.deepEqual(outcome.results.map((result) => result.status), ["CREATED", "CREATED", "CREATED"]);
  assert.deepEqual(db.calls, { runLine: 3, runGroup: 0, attempts: 0 });
  assert.deepEqual([outcome.groupsWritten, outcome.groupsRolledBack, outcome.groupsRefused], [0, 0, 0]);
});
