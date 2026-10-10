import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSupplierOptions,
  filterBySupplier,
  matchesSupplier,
  productMatchesSupplier,
} from "./loading-supplier-filter";

type Line = { productId: string; name: string; supplierId?: string | null; supplierName?: string | null };

const coca: Line = { productId: "p1", name: "Coca 33", supplierId: "s-coca", supplierName: "Coca-Cola" };
const fanta: Line = { productId: "p2", name: "Fanta 33", supplierId: "s-coca", supplierName: "Coca-Cola" };
const sidi: Line = { productId: "p3", name: "Eau 1L", supplierId: "s-sidi", supplierName: "Sidi Ali" };
// a second supplier with the SAME display name, and similar product names
const cocaHomonym: Line = { productId: "p4", name: "Coca 33", supplierId: "s-coca-2", supplierName: "Coca-Cola" };
const noSupplier: Line = { productId: "p5", name: "Produit sans fournisseur", supplierId: null, supplierName: null };
const legacyNoField: Line = { productId: "p6", name: "Ancien produit" }; // DTO from before the field existed
const lines: Line[] = [coca, fanta, sidi, cocaHomonym, noSupplier, legacyNoField];

test("« Tous les fournisseurs » (null) keeps every line, including lines without a supplier", () => {
  assert.deepEqual(filterBySupplier(lines, null), lines);
  assert.equal(filterBySupplier(lines, null), lines, "same array, nothing copied or altered");
});

test("a selected supplier keeps only its own lines", () => {
  assert.deepEqual(filterBySupplier(lines, { id: "s-coca" }).map((l) => l.productId), ["p1", "p2"]);
  assert.deepEqual(filterBySupplier(lines, { id: "s-sidi" }).map((l) => l.productId), ["p3"]);
});

test("products WITHOUT a supplier are hidden by any supplier filter and shown under « Tous »", () => {
  for (const id of ["s-coca", "s-sidi", "s-coca-2"]) {
    const kept = filterBySupplier(lines, { id }).map((l) => l.productId);
    assert.equal(kept.includes("p5"), false, id);
    assert.equal(kept.includes("p6"), false, id);
  }
  assert.ok(filterBySupplier(lines, null).some((l) => l.productId === "p5"));
});

test("similar products of different suppliers (same name, same supplier name) are told apart by supplier id", () => {
  assert.deepEqual(filterBySupplier(lines, { id: "s-coca" }).map((l) => l.productId), ["p1", "p2"]);
  assert.deepEqual(filterBySupplier(lines, { id: "s-coca-2" }).map((l) => l.productId), ["p4"]);
});

test("a supplier with no product on the sheet gives an empty list (never a fallback to everything)", () => {
  assert.deepEqual(filterBySupplier(lines, { id: "s-unknown" }), []);
});

test("filtering never mutates the lines (quantities, order, objects are untouched)", () => {
  const withQuantities = lines.map((line, index) => ({ ...line, initialLoadQuantity: index + 1, reloadedQuantity: 2 }));
  const snapshot = JSON.stringify(withQuantities);
  filterBySupplier(withQuantities, { id: "s-coca" });
  filterBySupplier(withQuantities, null);
  assert.equal(JSON.stringify(withQuantities), snapshot);
  const kept = filterBySupplier(withQuantities, { id: "s-sidi" });
  assert.equal(kept[0], withQuantities[2], "same object reference, not a copy");
});

test("matchesSupplier / productMatchesSupplier use the same strict rule", () => {
  assert.equal(matchesSupplier({ supplierId: "a" }, { id: "a" }), true);
  assert.equal(matchesSupplier({ supplierId: "a" }, { id: "b" }), false);
  assert.equal(matchesSupplier({ supplierId: null }, { id: "a" }), false);
  assert.equal(matchesSupplier({}, { id: "a" }), false);
  assert.equal(matchesSupplier({}, null), true);
  assert.equal(productMatchesSupplier({ supplier: { id: "a" } }, { id: "a" }), true);
  assert.equal(productMatchesSupplier({ supplier: { id: "a" } }, { id: "b" }), false);
  assert.equal(productMatchesSupplier({ supplier: null }, { id: "a" }), false);
  assert.equal(productMatchesSupplier({}, { id: "a" }), false);
  assert.equal(productMatchesSupplier({}, null), true);
});

test("supplier options: every existing supplier, plus suppliers only known from the lines, unique by id and sorted", () => {
  const existing = [
    { id: "s-sidi", name: "Sidi Ali", logoUrl: "data:image/png;base64,AAAA" },
    { id: "s-coca", name: "Coca-Cola" },
    { id: "s-coca-2", name: "Coca-Cola" },
  ];
  const withInactive = [...lines, { supplierId: "s-old", supplierName: "Ancien fournisseur" }, { supplierId: "s-sidi", supplierName: "Sidi Ali (renamed)" }];
  const options = buildSupplierOptions(existing, withInactive);
  assert.deepEqual(
    options.map((o) => o.id),
    ["s-old", "s-coca", "s-coca-2", "s-sidi"],
  );
  assert.equal(options.find((o) => o.id === "s-sidi")?.name, "Sidi Ali", "the existing supplier wins over the line's name");
  assert.equal(options.find((o) => o.id === "s-sidi")?.logoUrl, "data:image/png;base64,AAAA", "logo kept");
  assert.equal(options.filter((o) => o.name === "Coca-Cola").length, 2, "homonyms stay two options");
  assert.deepEqual(buildSupplierOptions([], [noSupplier, legacyNoField]), [], "lines without supplier add no option");
});
