import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findOptionalImportColumns,
  findRequiredImportHeader,
  looseHeaderKey,
  parseOptionalImportCells,
  tierThresholdsError,
  type OptionalImportField,
} from "./products-import-pricing";

const OLD_HEADER = ["ref_produit", "ref_fournisseur", "designation", "type", "prixAchatTTC", "prixGros", "taux_tva", "QuantiteStock"];
const NEW_HEADER = [...OLD_HEADER, "prix_detail", "prix_semi_gros", "Qped", "Qgros", "unite"];
// what the page does to a required header before looking it up
const pageNorm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

function parseLine(header: unknown[], cells: unknown[]) {
  const columns = findOptionalImportColumns(header);
  return parseOptionalImportCells((field: OptionalImportField) => cells[columns[field] as number], columns);
}

test("an OLD file has none of the optional columns: nothing is read, nothing is sent", () => {
  assert.deepEqual(findOptionalImportColumns(OLD_HEADER), {});
  assert.deepEqual(parseLine(OLD_HEADER, ["R1", "F1", "X", "T", 10, 12, 20, 5]), { values: {}, errors: [] });
});

test("a NEW file: every optional column is found, whatever the case / accents / separators", () => {
  assert.deepEqual(findOptionalImportColumns(NEW_HEADER), {
    retailPriceTTC: 8,
    semiWholesalePriceTTC: 9,
    semiWholesaleMinQty: 10,
    wholesaleMinQty: 11,
    unit: 12,
  });
  for (const spelling of ["prix_detail", "Prix détail", "PRIX-DETAIL", "prixDetail", " prix detail TTC "]) {
    assert.equal(looseHeaderKey(spelling).startsWith("prixdetail"), true, spelling);
    assert.equal(findOptionalImportColumns([spelling]).retailPriceTTC, 0, spelling);
  }
  assert.equal(findOptionalImportColumns(["QPED", "q gros", "Unité"]).wholesaleMinQty, 1);
  assert.equal(findOptionalImportColumns(["QPED", "q gros", "Unité"]).unit, 2);
});

test("prix_gros is the SAME required column as prixGros (no second price field)", () => {
  const withAlias = OLD_HEADER.map((h) => (h === "prixGros" ? "prix_gros" : h)).map(pageNorm);
  assert.equal(findRequiredImportHeader(withAlias, "prixgros"), 5);
  assert.equal(findRequiredImportHeader(OLD_HEADER.map(pageNorm), "prixgros"), 5);
  // when both exist, the historical prixGros wins
  assert.equal(findRequiredImportHeader(["prix_gros", "prixgros"], "prixgros"), 1);
  // no alias for the other columns, and a missing column stays missing
  assert.equal(findRequiredImportHeader(["ref_produit"], "prixgros"), -1);
  assert.equal(findRequiredImportHeader(OLD_HEADER.map(pageNorm), "ref_produit"), 0);
});

test("valid optional values are sent (prices TTC as typed, thresholds as whole quantities, unit trimmed)", () => {
  const { values, errors } = parseLine(NEW_HEADER, ["R", "F", "X", "T", 3, 4, 20, 10, "5", "4,50", 6, "24", "  pack  "]);
  assert.deepEqual(errors, []);
  assert.deepEqual(values, { retailPriceTTC: 5, semiWholesalePriceTTC: 4.5, semiWholesaleMinQty: 6, wholesaleMinQty: 24, unit: "pack" });
});

test("an EMPTY cell in a present column is not sent (the stored value is kept, never set to 0)", () => {
  const { values, errors } = parseLine(NEW_HEADER, ["R", "F", "X", "T", 3, 4, 20, 10, "", null, "   ", undefined, ""]);
  assert.deepEqual(errors, []);
  assert.deepEqual(values, {});
  // only the filled ones travel
  assert.deepEqual(parseLine(NEW_HEADER, ["R", "F", "X", "T", 3, 4, 20, 10, 5, "", "", "", ""]).values, { retailPriceTTC: 5 });
  // 0 typed in a price cell IS a value (a free retail price is the user's decision)
  assert.deepEqual(parseLine(NEW_HEADER, ["R", "F", "X", "T", 3, 4, 20, 10, 0, "", "", "", ""]).values, { retailPriceTTC: 0 });
});

test("invalid values are reported on the line, with the column name", () => {
  const cases: Array<[unknown[], RegExp]> = [
    [[-1, "", "", "", ""], /prix_detail invalide/],
    [["abc", "", "", "", ""], /prix_detail invalide/],
    [["", "5 DH", "", "", ""], /prix_semi_gros invalide/],
    [["", "", 0, "", ""], /Qped invalide/],
    [["", "", 2.5, "", ""], /Qped invalide/],
    [["", "", "", -3, ""], /Qgros invalide/],
    [["", "", "", "douze", ""], /Qgros invalide/],
    [["", "", 24, 6, ""], /Qped \(24\) doit être inférieur à Qgros \(6\)/],
    [["", "", 6, 6, ""], /Qped \(6\) doit être inférieur à Qgros \(6\)/],
    [["", "", "", "", "x".repeat(41)], /unite trop longue/],
  ];
  for (const [optionalCells, message] of cases) {
    const { values, errors } = parseLine(NEW_HEADER, ["R", "F", "X", "T", 3, 4, 20, 10, ...optionalCells]);
    assert.ok(errors.some((error) => message.test(error)), `${JSON.stringify(optionalCells)} -> ${errors.join(" / ")}`);
    // a refused value is never sent
    if (/prix_detail/.test(message.source)) assert.equal(values.retailPriceTTC, undefined);
  }
});

test("Qped < Qgros is checked only when both are known", () => {
  assert.equal(tierThresholdsError(6, 24), null);
  assert.equal(tierThresholdsError(null, 24), null);
  assert.equal(tierThresholdsError(6, undefined), null);
  assert.match(tierThresholdsError(24, 24) ?? "", /inférieur/);
});
