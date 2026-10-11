import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_PRODUCT_COLUMN_SETTINGS,
  PRODUCT_COLUMNS,
  isProductColumnVisible,
  parseProductColumnSettings,
  visibleProductColumns,
  withProductColumnVisibility,
} from "./product-columns";

const headers = (settings = DEFAULT_PRODUCT_COLUMN_SETTINGS) => visibleProductColumns(settings).map((column) => column.header);

test("no saved choice (null) = exactly the columns the table always had, in the same order", () => {
  assert.deepEqual(parseProductColumnSettings(null), { columns: {} });
  assert.deepEqual(headers(parseProductColumnSettings(null)), [
    "Photo",
    "Reference",
    "Designation",
    "Categorie",
    "Fournisseur",
    "Prix achat TTC",
    "Prix vente TTC",
    "TVA",
    "Stock min.",
    "Statut",
  ]);
});

test("every requested column is configurable: référence, désignation, fournisseur, type, 3 prices, Qped, Qgros, unité, TVA, stock", () => {
  const labels = PRODUCT_COLUMNS.map((column) => column.label);
  for (const expected of [
    "Référence produit",
    "Désignation",
    "Fournisseur",
    "Type (catégorie)",
    "Prix détail TTC",
    "Prix semi-gros TTC",
    "Prix gros TTC (prix de vente)",
    "Qped (seuil semi-gros)",
    "Qgros (seuil gros)",
    "Unité",
    "Taux de TVA",
    "Quantité en stock (tous emplacements)",
  ]) {
    assert.ok(labels.includes(expected), expected);
  }
});

test("showing / hiding columns; table order is kept whatever the order of the choices", () => {
  let settings = DEFAULT_PRODUCT_COLUMN_SETTINGS;
  settings = withProductColumnVisibility(settings, "stockQuantity", true);
  settings = withProductColumnVisibility(settings, "retailPriceTTC", true);
  settings = withProductColumnVisibility(settings, "photo", false);
  settings = withProductColumnVisibility(settings, "purchasePriceTTC", false);
  assert.deepEqual(headers(settings), [
    "Reference",
    "Designation",
    "Categorie",
    "Fournisseur",
    "Prix détail TTC",
    "Prix vente TTC",
    "TVA",
    "Qté en stock",
    "Stock min.",
    "Statut",
  ]);
  // the stored value round-trips (what the page reloads from the organisation)
  assert.deepEqual(parseProductColumnSettings(JSON.parse(JSON.stringify(settings))), settings);
});

test("the designation can never be hidden - not by the panel, not by a forged or stored value", () => {
  assert.equal(withProductColumnVisibility(DEFAULT_PRODUCT_COLUMN_SETTINGS, "designation", false), DEFAULT_PRODUCT_COLUMN_SETTINGS);
  const forged = parseProductColumnSettings({ columns: { designation: false } });
  assert.deepEqual(forged, { columns: {} });
  assert.equal(isProductColumnVisible({ columns: { designation: false } }, "designation"), true);
  // even with every other column hidden the table keeps a usable column
  const allHidden = parseProductColumnSettings({
    columns: Object.fromEntries(PRODUCT_COLUMNS.map((column) => [column.key, false])),
  });
  assert.deepEqual(headers(allHidden), ["Designation"]);
});

test("garbage is ignored: unknown keys, non-boolean values, arrays, strings", () => {
  for (const value of [undefined, 42, "x", [], { columns: [] }, { columns: "a" }, { hidden: ["photo"] }]) {
    assert.deepEqual(parseProductColumnSettings(value), { columns: {} }, JSON.stringify(value));
  }
  assert.deepEqual(
    parseProductColumnSettings({ columns: { photo: "no", unit: true, purchasePrice: false, "<script>": true } }),
    { columns: { unit: true } },
  );
});
