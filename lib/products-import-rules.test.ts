import assert from "node:assert/strict";
import { test } from "node:test";

import { computePriceHTFromTTC } from "@/lib/product-pricing";
import {
  classifyPreloadedRows,
  describeImportValidationError,
  productImportBatchSchema,
  productImportSchema,
  type ClassifiedProductRow,
  type ProductImportPreload,
  type ProductImportRow,
} from "@/lib/products-import-rules";
import { buildImportReport, runBatchedImport, type BatchResponse } from "@/lib/products-import-batches";
import { isImportableStatus } from "@/lib/products-import-shared";

const pad = (value: number, size = 6) => String(value).padStart(size, "0");

function fileRow(index: number, overrides: Partial<ProductImportRow> = {}): ProductImportRow {
  return {
    excelRow: index + 1,
    reference: `PRD-${pad(index)}`,
    supplierCode: "FOUR-0018",
    name: `Coca-Cola Menthe 1kg - Réf ${pad(index, 4)}`,
    categoryName: "Conserves",
    purchasePriceTTC: 54.89,
    salePriceTTC: 59.47,
    taxRate: 10,
    targetStock: 125,
    ...overrides,
  };
}

const rowsOf = (count: number) => Array.from({ length: count }, (_, index) => fileRow(index + 1));

// ---- file / batch limits ---------------------------------------------------------------

test("the file schema accepts 5 000, 5 001, 10 000 and 15 000 lines, and refuses 15 001", () => {
  for (const count of [5000, 5001, 10000, 15000]) {
    assert.equal(productImportSchema.safeParse({ rows: rowsOf(count) }).success, true, `${count} lines`);
  }
  const over = productImportSchema.safeParse({ rows: rowsOf(15001) });
  assert.equal(over.success, false);
  if (!over.success) {
    assert.equal(over.error.issues[0].code, "too_big");
    assert.equal(
      describeImportValidationError(over.error, { rows: rowsOf(15001) }),
      "Le fichier contient 15 001 lignes. Le maximum autorisé est de 15 000 lignes.",
    );
  }
});

test("a write request carries one batch only: 500 lines at most, never the whole file", () => {
  assert.equal(productImportBatchSchema.safeParse({ rows: rowsOf(200) }).success, true);
  assert.equal(productImportBatchSchema.safeParse({ rows: rowsOf(500) }).success, true);
  const over = productImportBatchSchema.safeParse({ rows: rowsOf(501) });
  assert.equal(over.success, false);
  if (!over.success) assert.match(describeImportValidationError(over.error, { rows: rowsOf(501) }, "batch"), /500 lignes.*501/);
});

test("a bad cell is reported with its Excel line and field, not as a bare 'Lignes import invalides.'", () => {
  const rows = [fileRow(1), fileRow(2), { ...fileRow(3), excelRow: 77, taxRate: 150 }];
  const result = productImportSchema.safeParse({ rows });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(describeImportValidationError(result.error, { rows }), "Lignes import invalides : ligne Excel 77 (champ taxRate).");
  }
  // a body that is not even a list still gets the generic message
  const garbage = productImportSchema.safeParse({});
  if (!garbage.success) assert.equal(describeImportValidationError(garbage.error, {}), "Lignes import invalides.");
});

test("the row contract itself is unchanged (the example line of the file is valid)", () => {
  assert.equal(productImportSchema.safeParse({ rows: [fileRow(1)] }).success, true);
  for (const bad of [{ taxRate: -1 }, { taxRate: 101 }, { purchasePriceTTC: -0.01 }, { targetStock: 1.5 }, { reference: "  " }, { supplierCode: "" }]) {
    assert.equal(productImportSchema.safeParse({ rows: [fileRow(1, bad)] }).success, false, JSON.stringify(bad));
  }
  assert.equal(productImportSchema.safeParse({ rows: [fileRow(1, { targetStock: -4 })] }).success, true, "a negative stock target is allowed");
});

// ---- classification --------------------------------------------------------------------

const SUPPLIER = { id: "sup-18", code: "FOUR-0018", name: "Fournisseur 18", active: true };
const CATEGORY = { id: "cat-conserves", name: "Conserves" };

function stored(row: ProductImportRow, overrides: Partial<ProductImportPreload["products"][number]> = {}) {
  return {
    id: `prod-${row.reference}`,
    reference: row.reference,
    name: row.name,
    defaultSupplierId: SUPPLIER.id,
    defaultSupplierName: SUPPLIER.name,
    categoryId: CATEGORY.id,
    categoryName: CATEGORY.name,
    purchasePrice: computePriceHTFromTTC(row.purchasePriceTTC, row.taxRate),
    salePrice: computePriceHTFromTTC(row.salePriceTTC, row.taxRate),
    taxRate: row.taxRate,
    ...overrides,
  };
}

function preloadOf(products: ReturnType<typeof stored>[], stock = 125): ProductImportPreload {
  return {
    products,
    suppliers: [SUPPLIER],
    categories: [CATEGORY],
    stockByProduct: new Map(products.map((product) => [product.id, stock])),
  };
}

test("classification: NEW / UPDATE / UNCHANGED / CONFLICT / ERROR, each by its existing rule", () => {
  const fresh = fileRow(1);
  const changedPrice = fileRow(2);
  const same = fileRow(3);
  const dupA = fileRow(4, { reference: "DUP" });
  const dupB = fileRow(5, { reference: "DUP" });
  const noSupplier = fileRow(6, { supplierCode: "FOUR-9999" });
  const preload = preloadOf([stored(changedPrice, { purchasePrice: 1 }), stored(same)]);

  const { rows, summary } = classifyPreloadedRows([fresh, changedPrice, same, dupA, dupB, noSupplier], preload);
  assert.deepEqual(
    rows.map((row) => row.status),
    ["NEW", "EXISTING_UPDATE", "EXISTING_UNCHANGED", "CONFLICT", "CONFLICT", "ERROR"],
  );
  assert.deepEqual(summary, { total: 6, new: 1, update: 1, unchanged: 1, conflicts: 2, errors: 1 });
  assert.deepEqual(Object.keys(rows[1].changes), ["purchasePriceHT"]);
  assert.equal(rows[5].message, "Fournisseur introuvable : FOUR-9999");
  assert.equal(rows[1].existingId, "prod-PRD-000002");
  assert.equal(rows[0].categoryCreate, false);
});

test("classification: an inactive supplier, a new category, a changed stock / name / VAT are detected as before", () => {
  const inactive = fileRow(1);
  const newCategory = fileRow(2, { categoryName: "Boissons" });
  const stockChange = fileRow(3);
  const vatChange = fileRow(4);
  const preload = preloadOf([stored(stockChange), stored(vatChange, { taxRate: 20 })], 100);
  preload.suppliers = [{ ...SUPPLIER, active: true }, { id: "sup-off", code: "FOUR-OFF", name: "Off", active: false }];
  const { rows } = classifyPreloadedRows([fileRow(1, { supplierCode: "FOUR-OFF" }), newCategory, stockChange, vatChange], preload);
  assert.equal(inactive.reference, "PRD-000001");
  assert.equal(rows[0].message, "Fournisseur inactif : FOUR-OFF");
  assert.deepEqual([rows[1].status, rows[1].categoryCreate], ["NEW", true]);
  assert.deepEqual([rows[2].status, Object.keys(rows[2].changes)], ["EXISTING_UPDATE", ["stock"]]);
  assert.equal(rows[3].changes.taxRate?.old, "20");
});

// ---- the 10 000-line scenario, end to end (classify -> send -> report) -------------------

function scenarioFile() {
  const file: ProductImportRow[] = [];
  const products: ReturnType<typeof stored>[] = [];
  let index = 0;
  const next = (overrides: Partial<ProductImportRow> = {}) => {
    index += 1;
    return fileRow(index, overrides);
  };
  for (let i = 0; i < 7000; i += 1) file.push(next()); // NEW
  for (let i = 0; i < 1000; i += 1) {
    const row = next();
    file.push(row);
    products.push(stored(row, { purchasePrice: 1 })); // UPDATE: the stored price differs
  }
  for (let i = 0; i < 1000; i += 1) {
    const row = next();
    file.push(row);
    products.push(stored(row)); // UNCHANGED
  }
  for (let i = 0; i < 250; i += 1) {
    const reference = `DUP-${pad(i)}`;
    file.push(next({ reference }), next({ reference })); // CONFLICT: the same reference twice
  }
  for (let i = 0; i < 500; i += 1) file.push(next({ supplierCode: "FOUR-9999" })); // ERROR: unknown supplier
  return { file, products };
}

test("10 000 lines: 7 000 NEW, 1 000 UPDATE, 1 000 UNCHANGED, 500 CONFLICT, 500 ERROR - only the 8 000 importable ones are sent, in 40 batches of 200", async () => {
  const { file, products } = scenarioFile();
  assert.equal(file.length, 10000);
  assert.equal(productImportSchema.safeParse({ rows: file }).success, true);

  const { rows: classified, summary } = classifyPreloadedRows(file, preloadOf(products));
  assert.deepEqual(summary, { total: 10000, new: 7000, update: 1000, unchanged: 1000, conflicts: 500, errors: 500 });

  const importable = classified.filter((row) => isImportableStatus(row.status));
  assert.equal(importable.length, 8000);

  const statusByRow = new Map(classified.map((row) => [row.excelRow, row.status]));
  const sentBatches: number[][] = [];
  const progressSeen: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const result = await runBatchedImport({
    rows: importable,
    onProgress: (progress) => progressSeen.push(progress.processed),
    sendBatch: async (batch): Promise<BatchResponse> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      sentBatches.push(batch.map((row) => row.excelRow));
      return {
        rows: batch.map((row) => ({
          excelRow: row.excelRow,
          reference: row.reference,
          name: row.name,
          status: statusByRow.get(row.excelRow) === "NEW" ? "CREATED" : "UPDATED",
          message: "ok",
        })),
      };
    },
  });

  // 40 requests of 200 lines, one at a time
  assert.equal(sentBatches.length, 40);
  assert.ok(sentBatches.every((batch) => batch.length === 200));
  assert.equal(maxInFlight, 1);
  // nothing that was not importable was sent, nothing was sent twice
  const sent = sentBatches.flat();
  assert.equal(new Set(sent).size, 8000);
  assert.ok(sent.every((excelRow) => isImportableStatus(statusByRow.get(excelRow))));
  for (const status of ["EXISTING_UNCHANGED", "CONFLICT", "ERROR"] as const) {
    assert.ok(sent.every((excelRow) => statusByRow.get(excelRow) !== status), status);
  }
  // progress counts the 8 000 lines to import: 0 / 8 000, 200 / 8 000, ... 8 000 / 8 000
  assert.deepEqual(progressSeen.slice(0, 3), [0, 200, 400]);
  assert.equal(progressSeen.at(-1), 8000);
  assert.equal(result.progress.total, 8000);
  assert.deepEqual([result.progress.created, result.progress.updated, result.progress.errors], [7000, 1000, 0]);
  assert.equal(result.stopped, "completed");

  // the report adds what the preview set aside; conflicts / errors make it "avec erreurs"
  const report = buildImportReport(result, { unchanged: summary.unchanged, conflicts: summary.conflicts, errors: summary.errors });
  assert.deepEqual(
    [report.title, report.created, report.updated, report.unchanged, report.conflicts, report.errors],
    ["Import terminé avec erreurs", 7000, 1000, 1000, 500, 500],
  );
});

test("re-running the same file after the import creates nothing twice: the imported lines come back UNCHANGED", () => {
  const { file, products } = scenarioFile();
  const first = classifyPreloadedRows(file, preloadOf(products));
  // what the first run wrote: every NEW / UPDATE line is now stored exactly as in the file
  const afterImport = [...products];
  for (const row of first.rows) {
    if (row.status === "NEW") afterImport.push(stored(row));
  }
  const updated = new Set(first.rows.filter((row) => row.status === "EXISTING_UPDATE").map((row) => row.reference));
  const stateAfter = afterImport.map((product) => (updated.has(product.reference) ? stored({ ...file.find((row) => row.reference === product.reference)! }) : product));

  const second = classifyPreloadedRows(file, preloadOf(stateAfter));
  assert.deepEqual(
    [second.summary.new, second.summary.update, second.summary.unchanged, second.summary.conflicts, second.summary.errors],
    [0, 0, 9000, 500, 500],
  );
  assert.equal(second.rows.filter((row: ClassifiedProductRow) => isImportableStatus(row.status)).length, 0);
});
