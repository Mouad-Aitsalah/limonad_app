import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { computePriceHTFromTTC } from "@/lib/product-pricing";
import {
  classifyPreloadedRows,
  importedOptionalProductFields,
  productImportSchema,
  type ProductImportPreload,
  type ProductImportRow,
} from "@/lib/products-import-rules";

// One existing product, stored with complete tiers (HT) and a unit.
const stored: ProductImportPreload["products"][number] = {
  id: "p-1",
  reference: "EAU-5L",
  name: "Eau 5L",
  defaultSupplierId: "s-1",
  defaultSupplierName: "SUP",
  categoryId: "c-1",
  categoryName: "Eaux",
  purchasePrice: computePriceHTFromTTC(3, 20),
  salePrice: computePriceHTFromTTC(4, 20),
  taxRate: 20,
  retailPrice: computePriceHTFromTTC(5, 20),
  semiWholesalePrice: computePriceHTFromTTC(4.5, 20),
  semiWholesaleMinQty: 6,
  wholesaleMinQty: 24,
  unit: "pack",
};

function preload(products = [stored]): ProductImportPreload {
  return {
    products,
    suppliers: [{ id: "s-1", code: "SUP", name: "SUP", active: true }],
    categories: [{ id: "c-1", name: "Eaux" }],
    stockByProduct: new Map([["p-1", 10]]),
  };
}

// The line as an OLD file sends it: none of the optional fields.
const oldLine = (over: Partial<ProductImportRow> = {}): ProductImportRow => ({
  excelRow: 2,
  reference: "EAU-5L",
  supplierCode: "SUP",
  name: "Eau 5L",
  categoryName: "Eaux",
  purchasePriceTTC: 3,
  salePriceTTC: 4,
  taxRate: 20,
  targetStock: 10,
  ...over,
});
const classify = (row: ProductImportRow, products = [stored]) => classifyPreloadedRows([row], preload(products)).rows[0];

test("OLD file on a product that has tiers: unchanged, and nothing optional would be written", () => {
  const row = classify(oldLine());
  assert.equal(row.status, "EXISTING_UNCHANGED");
  assert.deepEqual(row.changes, {});
  assert.deepEqual(importedOptionalProductFields(row), {});
  // a real change of an old column is still an update - and still writes no optional field
  const update = classify(oldLine({ salePriceTTC: 4.2 }));
  assert.equal(update.status, "EXISTING_UPDATE");
  assert.deepEqual(Object.keys(update.changes), ["salePriceHT"]);
  assert.deepEqual(importedOptionalProductFields(update), {});
});

test("NEW file, same values as stored: unchanged (TTC -> HT exactly like prixGros)", () => {
  const row = classify(oldLine({ retailPriceTTC: 5, semiWholesalePriceTTC: 4.5, semiWholesaleMinQty: 6, wholesaleMinQty: 24, unit: "pack" }));
  assert.equal(row.status, "EXISTING_UNCHANGED");
  assert.equal(row.retailPriceHT, computePriceHTFromTTC(5, 20));
  assert.equal(row.semiWholesalePriceHT, computePriceHTFromTTC(4.5, 20));
});

test("NEW file with different values: one UPDATE listing each optional change, and exactly those fields written", () => {
  const row = classify(oldLine({ retailPriceTTC: 6, semiWholesalePriceTTC: 5, semiWholesaleMinQty: 10, wholesaleMinQty: 50, unit: "carton" }));
  assert.equal(row.status, "EXISTING_UPDATE");
  assert.deepEqual(Object.keys(row.changes).sort(), ["retailPriceHT", "semiWholesaleMinQty", "semiWholesalePriceHT", "unit", "wholesaleMinQty"]);
  assert.deepEqual(row.changes.semiWholesaleMinQty, { old: "6", new: "10" });
  assert.deepEqual(row.changes.unit, { old: "pack", new: "carton" });
  assert.deepEqual(importedOptionalProductFields(row), {
    retailPrice: computePriceHTFromTTC(6, 20),
    semiWholesalePrice: computePriceHTFromTTC(5, 20),
    semiWholesaleMinQty: 10,
    wholesaleMinQty: 50,
    unit: "carton",
  });
});

test("only SOME optional cells filled: only those are compared and written, the others are kept", () => {
  const row = classify(oldLine({ retailPriceTTC: 5.5 }));
  assert.equal(row.status, "EXISTING_UPDATE");
  assert.deepEqual(Object.keys(row.changes), ["retailPriceHT"]);
  assert.deepEqual(importedOptionalProductFields(row), { retailPrice: computePriceHTFromTTC(5.5, 20) });
});

test("a brand-new product: its tiers come from the file; without them it has none (and the default unit)", () => {
  const withTiers = classify(oldLine({ reference: "NEW-1", retailPriceTTC: 5, semiWholesalePriceTTC: 4.5, semiWholesaleMinQty: 6, wholesaleMinQty: 24, unit: "u" }));
  assert.equal(withTiers.status, "NEW");
  assert.deepEqual(importedOptionalProductFields(withTiers), {
    retailPrice: computePriceHTFromTTC(5, 20),
    semiWholesalePrice: computePriceHTFromTTC(4.5, 20),
    semiWholesaleMinQty: 6,
    wholesaleMinQty: 24,
    unit: "u",
  });
  const plain = classify(oldLine({ reference: "NEW-2" }));
  assert.equal(plain.status, "NEW");
  assert.deepEqual(importedOptionalProductFields(plain), {});
  // the Prisma store writes the historical default unit first, then only the fields the file carries
  const apply = readFileSync(path.join(process.cwd(), "lib/server/products-import-apply.ts"), "utf8");
  assert.match(apply, /unit: "unité",\s*\.\.\.importedOptionalProductFields\(row\),/);
  assert.match(apply, /taxRate: row\.taxRate,[\s\S]*?\.\.\.importedOptionalProductFields\(row\),[\s\S]*?\}\s*,?\s*\}\);\s*if \(count === 0\)/);
});

test("Qped must stay below Qgros, checked against what the product will REALLY have (file value, else stored)", () => {
  // file alone
  assert.match(classify(oldLine({ reference: "NEW-3", semiWholesaleMinQty: 24, wholesaleMinQty: 6 })).message, /Qped \(24\) doit être inférieur à Qgros \(6\)/);
  // file Qped against stored Qgros 24
  const againstStoredGros = classify(oldLine({ semiWholesaleMinQty: 30 }));
  assert.equal(againstStoredGros.status, "ERROR");
  assert.match(againstStoredGros.message, /Qped \(30\) doit être inférieur à Qgros \(24\)/);
  // file Qgros against stored Qped 6
  assert.equal(classify(oldLine({ wholesaleMinQty: 6 })).status, "ERROR");
  // a consistent pair replacing both stored values is fine
  assert.equal(classify(oldLine({ semiWholesaleMinQty: 30, wholesaleMinQty: 60 })).status, "EXISTING_UPDATE");
  // an ERROR line writes nothing (the writer skips ERROR lines)
});

test("the server contract refuses invalid optional values, and still accepts an old line without them", () => {
  const parse = (over: Partial<ProductImportRow>) => productImportSchema.safeParse({ rows: [oldLine(over)] }).success;
  assert.equal(parse({}), true);
  assert.equal(parse({ retailPriceTTC: 5, semiWholesalePriceTTC: 4.5, semiWholesaleMinQty: 6, wholesaleMinQty: 24, unit: "pack" }), true);
  assert.equal(parse({ retailPriceTTC: -1 }), false);
  assert.equal(parse({ semiWholesalePriceTTC: Number.NaN }), false);
  assert.equal(parse({ semiWholesaleMinQty: 0 }), false);
  assert.equal(parse({ wholesaleMinQty: 2.5 }), false);
  assert.equal(parse({ unit: "" }), false);
  assert.equal(parse({ unit: "x".repeat(41) }), false);
});
