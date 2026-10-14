import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProductGrid } from "@/lib/import-export/products-format";
import {
  classifyPreloadedRows,
  productImportRowSchema,
  type ProductImportRow,
} from "@/lib/products-import-rules";
import { finalizeVariantGroups, prepareVariantRows, variantGroupKeyOfRow } from "@/lib/products-import-variant-groups";
import {
  DEFAULT_VARIANT_TAX_RATE,
  confirmedCreationDefaults,
  describeVariantAttributes,
  externalErrorsForBatch,
  externalVariantErrors,
  parseTaxRateInput,
  selectLinesToWrite,
  variantDefaultsHint,
  variantGroupKeyOfLine,
  withVariantGroupSizes,
  type LocalRowForGroups,
} from "@/lib/products-import-variant-ui";

const cells = (parent: string, attrs: string, over: Partial<Record<number, unknown>> = {}) => {
  const row: unknown[] = [parent, "", "Sport", 100, 150, 5, attrs];
  for (const [index, value] of Object.entries(over)) row[Number(index)] = value;
  return row;
};

/** The browser's rows exactly as the import page builds them. */
function localRows(grid: unknown[][]): LocalRowForGroups[] {
  return parseProductGrid(grid).lines.map(({ line, errors }) => ({
    values: line,
    status: errors.length ? "ERROR" : "VALID",
    message: errors.join(" ; ") || "Valide",
  }));
}

test("the VAT proposed is 20 %, and what the user types is read strictly (0-100, comma or point, optional %)", () => {
  assert.equal(DEFAULT_VARIANT_TAX_RATE, 20);
  assert.equal(parseTaxRateInput("20"), 20);
  assert.equal(parseTaxRateInput(" 5,5 "), 5.5);
  assert.equal(parseTaxRateInput("7.5 %"), 7.5);
  assert.equal(parseTaxRateInput("0"), 0);
  assert.equal(parseTaxRateInput("100"), 100);
  for (const bad of ["", "abc", "101", "-1", "1,2,3", "20 20", "%"]) assert.equal(parseTaxRateInput(bad), null, bad);
});

test("the creation defaults are sent only once a supplier is chosen, the VAT is readable AND the user confirmed", () => {
  const ready = { supplierId: "s1", taxRateText: "20", confirmed: true };
  assert.deepEqual(confirmedCreationDefaults(ready), { supplierId: "s1", taxRate: 20 });
  assert.equal(confirmedCreationDefaults({ ...ready, confirmed: false }), null, "20 % pre-filled is a proposal, never an assumption");
  assert.equal(confirmedCreationDefaults({ ...ready, supplierId: "" }), null);
  assert.equal(confirmedCreationDefaults({ ...ready, taxRateText: "x" }), null);
  assert.equal(variantDefaultsHint(ready), null);
  assert.match(variantDefaultsHint({ ...ready, supplierId: "" })!, /fournisseur/);
  assert.match(variantDefaultsHint({ ...ready, taxRateText: "300" })!, /TVA invalide/);
  assert.match(variantDefaultsHint({ ...ready, confirmed: false })!, /Cochez la confirmation/);
});

test("the browser and the server compute the same group key for a line", () => {
  const [parsedRow] = localRows([cells("Arsenal  Survêtements", "TAILLE: S")]);
  const row = productImportRowSchema.parse(parsedRow.values);
  assert.equal(variantGroupKeyOfLine(parsedRow.values), variantGroupKeyOfRow(row));
  assert.equal(variantGroupKeyOfLine({ categoryName: "Sport" }), null, "an ordinary product is in no group");
  assert.equal(describeVariantAttributes(parsedRow.values.variantAttributes), "TAILLE: S");
  assert.equal(describeVariantAttributes(undefined), "");
});

test("a line refused in the browser still names its group: unreadable cell, bad price - not a plain product error", () => {
  const rows = localRows([
    cells("Short", "TAILLE: S"),
    cells("Short", "TAILLE M"), // unreadable variants cell
    cells("Short", "TAILLE: L", { 3: "abc" }), // readable variant, bad price
    ["Ballon", "", "Sport", "x", 50, 10, ""], // ordinary product with a bad price: no group
  ]);
  assert.deepEqual(rows.map((row) => row.status), ["VALID", "ERROR", "ERROR", "ERROR"]);
  const errors = externalVariantErrors(rows);
  assert.deepEqual(errors.map((error) => error.excelRow), [2, 3]);
  assert.equal(new Set(errors.map((error) => error.groupKey)).size, 1);
  assert.match(errors[0].message, /NOM: valeur/);
});

test("end to end: an unreadable variant in the browser blocks its whole group in the server's preview, other groups pass", () => {
  const rows = localRows([
    cells("Arsenal", "TAILLE: S | COULEUR: NOIR"),
    cells("Arsenal", "TAILLE: M | COULEUR: NOIR"),
    cells("Arsenal", "TAILLE L COULEUR NOIR"), // cannot be read in the browser: never sent
    cells("Short Nike", "TAILLE: S"),
  ]);
  const sent: ProductImportRow[] = rows.filter((row) => row.status === "VALID").map((row) => productImportRowSchema.parse(row.values));
  assert.equal(sent.length, 3);

  const prepared = prepareVariantRows(sent);
  const classified = classifyPreloadedRows(
    prepared.rows,
    {
      products: [],
      suppliers: [{ id: "s", code: "F1", name: "F", active: true }],
      categories: [{ id: "c", name: "Sport" }],
      stockByProduct: new Map(),
    },
    { applyStock: false, creationDefaults: { supplierCode: "F1", taxRate: 20 } },
  );
  const result = finalizeVariantGroups(classified, { problems: prepared.problems, externalErrors: externalVariantErrors(rows) });

  assert.deepEqual(result.rows.map((row) => [row.excelRow, row.status, row.groupBlocked ?? false]), [
    [1, "ERROR", true],
    [2, "ERROR", true],
    [4, "NEW", false],
  ]);
  assert.match(result.rows[0].message, /^Groupe bloqué \(ligne 3 : Valeur de variante mal formée/);
  assert.deepEqual(result.rows.map((row) => row.wouldBe), ["NEW", "NEW", undefined]);
  assert.equal(result.summary.new, 1, "only the other group is importable");
  assert.equal(result.summary.blocked, 2);
  assert.deepEqual(result.groups.map((group) => [group.parentName, group.blocked]), [["Arsenal", true], ["Short Nike", false]]);
});

test("withVariantGroupSizes: the size counts EVERY line of the file's group - the unreadable ones too - so a hidden line shows as a missing one", () => {
  const rows = localRows([
    cells("Short", "TAILLE: S"),
    cells("Short", "TAILLE: M"),
    cells("Short", "TAILLE L"), // unreadable: never sent
    cells("Maillot", "TAILLE: S"),
    ["Ballon", "", "Sport", 30, 50, 10, ""],
  ]);
  const sent = rows.filter((row) => row.status === "VALID").map((row) => row.values);
  const sized = withVariantGroupSizes(sent, rows);
  assert.deepEqual(sized.map((line) => line.variantGroupSize), [3, 3, 1, undefined]);
  assert.equal("variantGroupSize" in sized[3], false, "an ordinary line is returned untouched");
  assert.equal(sized[3], sent[3]);
});

test("selectLinesToWrite: a group goes whole as soon as one line is new or to update; never when a line is blocked, in error or unanswered", () => {
  const rows = localRows([
    cells("Short", "TAILLE: S"),
    cells("Short", "TAILLE: M"),
    cells("Short", "TAILLE: L"),
    cells("Maillot", "TAILLE: S"),
    cells("Maillot", "TAILLE: M"),
    cells("Polo", "TAILLE: S"),
    ["Ballon", "", "Sport", 30, 50, 10, ""],
    ["Filet", "", "Sport", 30, 50, 10, ""],
  ]);
  const lines = rows.map((row) => row.values);
  const answer = (...statuses: Array<string | undefined>) =>
    new Map<number, { status: string; groupBlocked?: boolean }>(statuses.flatMap((status, index) => (status ? [[lines[index].excelRow, { status, groupBlocked: false }] as [number, { status: string; groupBlocked?: boolean }]] : [])));
  const preview = answer(
    "EXISTING_UNCHANGED", "NEW", "EXISTING_UNCHANGED", // Short: one new line -> all three go
    "EXISTING_UNCHANGED", "EXISTING_UNCHANGED", //        Maillot: nothing to write -> none
    undefined, //                                         Polo: no answer yet -> none
    "NEW", "ERROR", //                                    Ballon goes, Filet does not
  );
  assert.deepEqual(selectLinesToWrite(lines, preview).map((line) => line.excelRow), [1, 2, 3, 7]);

  const blocked = new Map(preview);
  blocked.set(lines[2].excelRow, { status: "ERROR", groupBlocked: true });
  assert.deepEqual(selectLinesToWrite(lines, blocked).map((line) => line.excelRow), [7], "one line in error keeps the whole group out");
  const conflict = new Map(preview);
  conflict.set(lines[0].excelRow, { status: "CONFLICT", groupBlocked: true });
  assert.deepEqual(selectLinesToWrite(lines, conflict).map((line) => line.excelRow), [7]);
});

test("externalErrorsForBatch: only the refused lines of the groups that are in the batch travel with it", () => {
  const rows = localRows([
    cells("Short", "TAILLE: S"),
    cells("Short", "TAILLE M"), // refused
    cells("Maillot", "TAILLE: S"),
    cells("Maillot", "TAILLE L"), // refused
  ]);
  const sent = rows.filter((row) => row.status === "VALID").map((row) => row.values);
  assert.deepEqual(externalErrorsForBatch([sent[0]], rows).map((error) => error.excelRow), [2]);
  assert.deepEqual(externalErrorsForBatch(sent, rows).map((error) => error.excelRow), [2, 4]);
  assert.deepEqual(externalErrorsForBatch([], rows), []);
});
