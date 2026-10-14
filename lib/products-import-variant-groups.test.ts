import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProductGrid } from "@/lib/import-export/products-format";
import {
  classifyPreloadedRows,
  creationDefaultsSchema,
  productImportBatchSchema,
  productImportRowSchema,
  productImportSchema,
  variantIdentityKey,
  rowCarriesVariantData,
  type ClassifiedProductRow,
  type ProductImportPreload,
  type ProductImportRow,
  type ResolvedCreationDefaults,
} from "@/lib/products-import-rules";
import { isImportableStatus } from "@/lib/products-import-shared";
import {
  finalizeVariantGroups,
  prepareVariantRows,
  variantGroupKeyOfRow,
  type ExternalVariantError,
} from "@/lib/products-import-variant-groups";
import { writeImportBatch, type ImportWriteStore } from "@/lib/products-import-writer";
import { variantFileGroupKey, variantGroupKeyOf, variantKeyOf } from "@/lib/products-import-variants";

// ---- helpers: the browser side (real parser) and the server side (real rules + groups) ---------------

type Cells = unknown[];
const fileRow = (parent: string, attrs: string, over: Partial<Record<number, unknown>> = {}): Cells => {
  const cells: Cells = [parent, "", "Sport", 100, 150, 5, attrs];
  for (const [index, value] of Object.entries(over)) cells[Number(index)] = value;
  return cells;
};

/** What the browser sends: the parsed lines that have no local error (exactly like toLine). */
function sentRows(grid: Cells[]): ProductImportRow[] {
  const parsed = parseProductGrid(grid);
  assert.equal(parsed.fatal, undefined);
  return parsed.lines.filter((entry) => !entry.errors.length).map((entry) => productImportRowSchema.parse(entry.line));
}

const SUPPLIER = { id: "sup1", code: "F1", name: "Fournisseur 1", active: true };
const emptyPreload = (over: Partial<ProductImportPreload> = {}): ProductImportPreload => ({
  products: [],
  suppliers: [SUPPLIER],
  categories: [{ id: "cat1", name: "Sport" }],
  brands: [],
  barcodeOwners: new Map(),
  stockByProduct: new Map(),
  ...over,
});
const DEFAULTS: ResolvedCreationDefaults = { supplierCode: "F1", taxRate: 20 };

/** The server pipeline of classifyProductImportRowsWith, without the database. */
function preview(
  rows: ProductImportRow[],
  options: { preload?: ProductImportPreload; defaults?: ResolvedCreationDefaults; external?: ExternalVariantError[]; applyStock?: boolean } = {},
) {
  const prepared = prepareVariantRows(rows);
  const classified = classifyPreloadedRows(prepared.rows, options.preload ?? emptyPreload(), {
    applyStock: options.applyStock ?? false,
    creationDefaults: "defaults" in options ? options.defaults : DEFAULTS,
  });
  if (!prepared.hasVariants) return { ...classified, groups: [] };
  return finalizeVariantGroups(classified, { problems: prepared.problems, externalErrors: options.external });
}

const byLine = (rows: ClassifiedProductRow[]) => new Map(rows.map((row) => [row.excelRow, row]));
const groupKey = (parent: string, category = "Sport") => variantFileGroupKey(parent, category);

const ARSENAL = [
  fileRow("Arsenal Survêtements", "TAILLE: S | COULEUR: NOIR"),
  fileRow("Arsenal Survêtements", "TAILLE: M | COULEUR: NOIR"),
  fileRow("Arsenal Survêtements", "TAILLE: L | COULEUR: NOIR"),
];

// ---- a clean file --------------------------------------------------------------------------------------

test("a valid file: variants grouped under their parent, new products created with the page's supplier and VAT", () => {
  const result = preview(sentRows([...ARSENAL, fileRow("Short Nike", "TAILLE: S"), ["Ballon", "", "Sport", 30, 50, 10, ""]]));
  assert.deepEqual(result.rows.map((row) => row.status), ["NEW", "NEW", "NEW", "NEW", "NEW"]);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups.map((group) => [group.parentName, group.variants, group.new, group.blocked]), [
    ["Arsenal Survêtements", 3, 3, false],
    ["Short Nike", 1, 1, false],
  ]);
  const first = result.rows[0];
  assert.equal(first.name, "Arsenal Survêtements - S / NOIR");
  assert.equal(first.supplierCode, "F1");
  assert.equal(first.taxRate, 20);
  assert.equal(first.appliedTaxRate, 20);
  assert.equal(first.supplierCreate, false, "the page's supplier exists: nothing is created");
  assert.equal(first.purchasePriceHT, 83.33, "prices are TTC in the file, HT = TTC / 1.20");
  assert.deepEqual(result.rows.map((row) => row.variantGroupIndex), [0, 0, 0, 1, undefined]);
  assert.deepEqual(result.summary, { total: 5, new: 5, unchanged: 0, update: 0, conflicts: 0, errors: 0 });
});

test("a file without any variants line is classified exactly as before (nothing prepared, no group)", () => {
  const rows = [
    productImportRowSchema.parse({ excelRow: 2, reference: "P1", name: "Eau", categoryName: "Sport", supplierCode: "F1", purchasePriceTTC: 5, salePriceTTC: 6, taxRate: 20 }),
    productImportRowSchema.parse({ excelRow: 3, reference: "P2" }),
  ];
  const prepared = prepareVariantRows(rows);
  assert.equal(prepared.rows, rows, "the very same array");
  assert.equal(prepared.hasVariants, false);
  const direct = classifyPreloadedRows(rows, emptyPreload(), { applyStock: false });
  assert.deepEqual(preview(rows, { defaults: undefined }).rows, direct.rows);
  assert.deepEqual(preview(rows, { defaults: undefined }).summary, direct.summary);
  assert.equal(Object.keys(direct.summary).includes("blocked"), false);
});

// ---- defaults: NEW products only ----------------------------------------------------------------------

test("the supplier and the VAT apply to NEW lines only: an existing product keeps its own", () => {
  const rows = sentRows([fileRow("Short Nike", "TAILLE: S", { 3: 105, 4: 210 }), fileRow("Short Nike", "TAILLE: M")]);
  const existingReference = rows[0].reference;
  const preload = emptyPreload({
    products: [
      {
        id: "p1",
        reference: existingReference,
        name: rows[0].name!,
        defaultSupplierId: "other",
        defaultSupplierName: "Autre fournisseur",
        categoryId: "cat1",
        categoryName: "Sport",
        purchasePrice: 100,
        salePrice: 200,
        taxRate: 5,
      },
    ],
  });
  const result = byLine(preview(rows, { preload }).rows);
  const existing = result.get(rows[0].excelRow)!;
  assert.equal(existing.status, "EXISTING_UNCHANGED", "105 TTC at 5 % = 100 HT, 210 TTC = 200 HT: the stored VAT was used, not the default");
  assert.equal(existing.supplierCode, undefined, "no supplier is written onto an existing product");
  assert.equal(existing.appliedTaxRate, undefined);
  assert.equal(existing.changes.supplier, undefined);
  assert.equal(existing.changes.taxRate, undefined);
  const created = result.get(rows[1].excelRow)!;
  assert.equal(created.status, "NEW");
  assert.equal(created.appliedTaxRate, 20);
});

test("without a supplier / VAT confirmed on the page, new variants are an ERROR that names what is missing - and block their group", () => {
  const result = preview(sentRows(ARSENAL), { defaults: undefined });
  for (const row of result.rows) {
    assert.equal(row.status, "ERROR");
    assert.match(row.message, /fournisseur \(à choisir sur la page\)/);
    assert.match(row.message, /TVA \(à confirmer sur la page\)/);
    assert.equal(row.groupBlocked, true);
  }
  assert.equal(result.groups[0].blocked, true);
  const withSupplierOnly = preview(sentRows(ARSENAL), { defaults: { supplierCode: "F1" } });
  assert.match(withSupplierOnly.rows[0].message, /TVA \(à confirmer sur la page\)/);
  assert.doesNotMatch(withSupplierOnly.rows[0].message, /fournisseur \(à choisir/);
});

test("the creation defaults contract: a rate between 0 and 100, a supplier id, nothing else", () => {
  assert.deepEqual(creationDefaultsSchema.parse({ supplierId: "abc", taxRate: 20 }), { supplierId: "abc", taxRate: 20 });
  assert.ok(creationDefaultsSchema.safeParse({ taxRate: 120 }).error);
  assert.ok(creationDefaultsSchema.safeParse({ taxRate: -1 }).error);
  assert.ok(creationDefaultsSchema.safeParse({ taxRate: Number.NaN }).error);
});

// ---- a group is blocked as a whole ---------------------------------------------------------------------

test("ONE invalid variant blocks the WHOLE group: no line of it is importable, other groups are not affected", () => {
  const rows = sentRows([...ARSENAL, fileRow("Short Nike", "TAILLE: S"), fileRow("Short Nike", "TAILLE: M")]);
  // the barcode of the second Arsenal line already belongs to another product of the organisation
  rows[1] = { ...rows[1], barcode: "611999", reference: "611999", referenceSource: "barcode" };
  const preload = emptyPreload({ barcodeOwners: new Map([["611999", "AUTRE-REF"]]) });
  const result = preview(rows, { preload });
  const lines = byLine(result.rows);
  const arsenal = [rows[0], rows[1], rows[2]].map((row) => lines.get(row.excelRow)!);

  assert.deepEqual(arsenal.map((row) => row.status), ["ERROR", "CONFLICT", "ERROR"]);
  assert.match(arsenal[1].message, /déjà utilisé par le produit AUTRE-REF/, "the offending line keeps its own message");
  for (const row of arsenal) {
    assert.equal(row.groupBlocked, true);
    assert.equal(isImportableStatus(row.status), false, "not importable");
  }
  assert.deepEqual(arsenal.filter((row) => row.wouldBe).map((row) => row.wouldBe), ["NEW", "NEW"], "what the innocent lines would have been");
  assert.match(arsenal[0].message, new RegExp(`^Groupe bloqué \\(ligne ${rows[1].excelRow} : .*Arsenal Survêtements`));

  // the other group is untouched
  const nike = [rows[3], rows[4]].map((row) => lines.get(row.excelRow)!);
  assert.deepEqual(nike.map((row) => row.status), ["NEW", "NEW"]);
  assert.equal(nike.some((row) => row.groupBlocked), false);

  assert.deepEqual(result.summary, { total: 5, new: 2, unchanged: 0, update: 0, conflicts: 1, errors: 0, blocked: 2 });
  assert.deepEqual(result.groups.map((group) => [group.blocked, group.problems, group.blockedRows, group.new]), [
    [true, 1, 2, 2],
    [false, 0, 0, 2],
  ]);
  assert.match(result.groups[0].reason!, new RegExp(`^ligne ${rows[1].excelRow} : `));
});

test("a blocked group can never reach the writer: not one transaction is opened for it", async () => {
  const rows = sentRows([...ARSENAL]);
  rows[2] = { ...rows[2], purchasePriceTTC: undefined };
  const result = preview(rows);
  assert.ok(result.rows.every((row) => row.status === "ERROR" || row.status === "CONFLICT"));
  assert.ok(result.rows.every((row) => !isImportableStatus(row.status)));

  let transactions = 0;
  const store: ImportWriteStore = {
    runLine: async () => {
      transactions += 1;
      throw new Error("a blocked group must never be written");
    },
    describeError: () => null,
  };
  // even if a client sent EVERY line of the group to the writer, each one is refused before any transaction
  const outcome = await writeImportBatch(store, result.rows);
  assert.equal(transactions, 0);
  assert.deepEqual(outcome.results.map((row) => row.status), ["ERROR", "ERROR", "ERROR"]);
  assert.equal(outcome.stockMovementsCreated, 0);
});

test("a line the browser could not send (invalid there) still blocks its group, through externalErrors", () => {
  const rows = sentRows(ARSENAL);
  const key = groupKey("Arsenal Survêtements");
  const result = preview(rows, { external: [{ groupKey: key, excelRow: 9, message: "Valeur de variante mal formée : « XL »." }] });
  assert.ok(result.rows.every((row) => row.status === "ERROR" && row.groupBlocked && row.wouldBe === "NEW"));
  assert.match(result.rows[0].message, /^Groupe bloqué \(ligne 9 : Valeur de variante mal formée/);
  assert.equal(result.summary.blocked, 3);
  assert.equal(result.summary.errors, 0, "the lines are blocked, not wrong themselves");
  // an external error of another group changes nothing
  const other = preview(rows, { external: [{ groupKey: groupKey("Short Nike"), excelRow: 9, message: "x" }] });
  assert.ok(other.rows.every((row) => row.status === "NEW"));
});

test("the same combination twice (any order, any case) is a CONFLICT that names both lines, and blocks the group", () => {
  const rows = sentRows([
    fileRow("Short", "TAILLE: S | COULEUR: Noir"),
    fileRow("short", "couleur: NOIR | taille: s"),
    fileRow("Short", "TAILLE: M | COULEUR: Noir"),
  ]);
  const result = preview(rows);
  assert.deepEqual(result.rows.map((row) => row.status), ["CONFLICT", "CONFLICT", "ERROR"]);
  assert.match(result.rows[0].message, /^Combinaison en double dans le fichier : TAILLE: S \| COULEUR: Noir \(lignes 1, 2\)\./);
  assert.equal(result.rows[2].wouldBe, "NEW");
  assert.equal(result.groups[0].blocked, true);
});

test("attribute names mixed inside one group: the odd lines are errors and the group is blocked", () => {
  const result = preview(
    sentRows([fileRow("Short", "TAILLE: S"), fileRow("Short", "TAILLE: M"), fileRow("Short", "TAILLE: L | COULEUR: Noir"), fileRow("Short", "TAILLE: XL")]),
  );
  assert.deepEqual(result.rows.map((row) => row.status), ["ERROR", "ERROR", "ERROR", "ERROR"]);
  assert.match(result.rows[2].message, /Structure d'attributs différente du reste du groupe \(attendu : TAILLE\)/);
  assert.deepEqual(result.rows.map((row) => row.wouldBe), ["NEW", "NEW", undefined, "NEW"]);
});

test("more than 200 variants for one parent: the lines beyond are errors and the group is blocked", () => {
  const grid = Array.from({ length: 201 }, (_, index) => fileRow("Short", `TAILLE: T${index}`));
  const result = preview(sentRows(grid));
  assert.equal(result.groups[0].variants, 201);
  assert.equal(result.rows[200].message.startsWith("Plus de 200 variantes"), true);
  assert.ok(result.rows.every((row) => row.status === "ERROR" && row.groupBlocked));
  assert.equal(result.summary.blocked, 200);
  const exactly200 = preview(sentRows(grid.slice(0, 200)));
  assert.ok(exactly200.rows.every((row) => row.status === "NEW"));
});

// ---- the server recomputes and validates --------------------------------------------------------------

test("the server recomputes the designation and the reference from the attributes - a tampered or stale line is refused", () => {
  const rows = sentRows([fileRow("Short", "TAILLE: S"), fileRow("Short", "TAILLE: M"), fileRow("Short", "TAILLE: L")]);
  const tampered = [
    { ...rows[0], reference: "OTHER-REF" },
    { ...rows[1], name: "Autre nom - M" },
    rows[2],
  ];
  const result = preview(tampered);
  assert.equal(result.rows[0].reference, rows[0].reference, "the recomputed reference is what the classification looked up");
  assert.equal(result.rows[1].name, rows[1].name);
  assert.match(result.rows[0].message, /^Référence incohérente avec la désignation et les attributs \(reçue : OTHER-REF, attendue : /);
  assert.match(result.rows[1].message, /^Désignation incohérente avec les attributs/);
  assert.deepEqual(result.rows.map((row) => row.status), ["ERROR", "ERROR", "ERROR"], "the group is blocked");
  assert.equal(result.rows[2].wouldBe, "NEW");
});

test("a parent without attributes (or attributes without parent) is refused, not guessed", () => {
  const [row] = sentRows([fileRow("Short", "TAILLE: S")]);
  const half = { ...row, variantParentName: undefined };
  const result = preview([half]);
  assert.equal(result.rows[0].status, "ERROR");
  assert.match(result.rows[0].message, /Variante incomplète/);
});

// ---- never overwrite another product -----------------------------------------------------------------

test("a reference already held by a DIFFERENT product is a CONFLICT, nothing is written; the same variant is updated normally", () => {
  const rows = sentRows([fileRow("Short", "TAILLE: S"), fileRow("Short", "TAILLE: M", { 3: 120, 4: 180 })]);
  const stored = (row: ProductImportRow, name: string, categoryName: string, purchasePrice: number) => ({
    id: "id-" + row.reference,
    reference: row.reference,
    name,
    defaultSupplierId: "sup1",
    defaultSupplierName: "Fournisseur 1",
    categoryId: "cat1",
    categoryName,
    purchasePrice,
    salePrice: 125,
    taxRate: 20,
  });
  const preload = emptyPreload({
    products: [stored(rows[0], "Un tout autre produit", "Sport", 83.33), stored(rows[1], rows[1].name!, "Sport", 50)],
  });
  const result = preview(rows, { preload });
  assert.equal(result.rows[0].status, "CONFLICT");
  assert.match(result.rows[0].message, /^Référence .* déjà utilisée par un autre produit \(désignation « Un tout autre produit »\) : conflit, rien ne sera écrit\./);
  assert.equal(result.rows[1].wouldBe, "EXISTING_UPDATE", "the second variant would be a normal update, but its group is blocked by the conflict");
  assert.equal(result.rows[1].status, "ERROR");
  assert.equal(result.groups[0].blocked, true);

  // without the conflicting product, the same variant is a normal update of its own price
  const alone = preview([rows[1]], { preload: emptyPreload({ products: [stored(rows[1], rows[1].name!, "Sport", 50)] }) });
  assert.equal(alone.rows[0].status, "EXISTING_UPDATE");
  assert.ok(alone.rows[0].changes.purchasePriceHT);
});

test("a stored product with the same reference in ANOTHER category, or another barcode, is a conflict too", () => {
  const [row] = sentRows([fileRow("Short", "TAILLE: S", { 1: "611555" })]);
  const base = { id: "p", reference: row.reference, name: row.name!, defaultSupplierId: "sup1", defaultSupplierName: "F", categoryId: "cat2", categoryName: "Plage", purchasePrice: 83.33, salePrice: 125, taxRate: 20 };
  const otherCategory = preview([row], { preload: emptyPreload({ products: [base] }) });
  assert.equal(otherCategory.rows[0].status, "CONFLICT");
  assert.match(otherCategory.rows[0].message, /catégorie « Plage »/);
  const otherBarcode = preview([row], { preload: emptyPreload({ products: [{ ...base, categoryId: "cat1", categoryName: "Sport", barcode: "999000" }] }) });
  assert.equal(otherBarcode.rows[0].status, "CONFLICT");
  assert.match(otherBarcode.rows[0].message, /code-barres 999000/);
});

// ---- the contract -------------------------------------------------------------------------------------

test("the row contract: variant fields are accepted with limits, a historical payload is unchanged", () => {
  const legacy = { excelRow: 2, reference: "P1", name: "Eau", barcode: "123" };
  assert.deepEqual(productImportRowSchema.parse(legacy), legacy);
  const variant = { excelRow: 2, reference: "R", variantParentName: "Short", variantAttributes: [{ name: "TAILLE", value: "S" }], referenceSource: "generated" };
  assert.deepEqual(productImportRowSchema.parse(variant), variant);
  assert.ok(productImportRowSchema.safeParse({ ...variant, variantAttributes: [] }).error);
  assert.ok(productImportRowSchema.safeParse({ ...variant, variantAttributes: Array.from({ length: 9 }, (_, i) => ({ name: "N" + i, value: "v" })) }).error);
  assert.ok(productImportRowSchema.safeParse({ ...variant, variantAttributes: [{ name: "x".repeat(61), value: "v" }] }).error);
  assert.ok(productImportRowSchema.safeParse({ ...variant, variantAttributes: [{ name: "T", value: "" }] }).error);
  assert.ok(productImportRowSchema.safeParse({ ...variant, referenceSource: "file" }).error);
  assert.equal(rowCarriesVariantData(legacy as ProductImportRow), false);
  assert.equal(rowCarriesVariantData(variant as ProductImportRow), true);
  assert.equal(rowCarriesVariantData({ referenceSource: "barcode" } as ProductImportRow), true);
});

test("the preview AND the write request accept the page's defaults and the browser-refused lines", () => {
  const body = {
    rows: [],
    applyStock: false,
    creationDefaults: { supplierId: "s", taxRate: 20 },
    externalErrors: [{ groupKey: groupKey("Short"), excelRow: 4, message: "x" }],
  };
  assert.deepEqual(productImportSchema.parse(body), body);
  assert.deepEqual(productImportBatchSchema.parse(body), body, "the write takes them too: the server checks the supplier / VAT again and counts the refused lines in the group size");
  assert.ok(productImportBatchSchema.safeParse({ rows: [], creationDefaults: { taxRate: 101 } }).error);
  assert.ok(productImportSchema.safeParse({ rows: [], creationDefaults: { taxRate: 101 } }).error);
});

test("group keys: the browser's key of a line and the server's are the same", () => {
  const [row] = sentRows([fileRow("Arsenal  SURVÊTEMENTS", "TAILLE: S")]);
  assert.equal(variantGroupKeyOfRow(row), groupKey("arsenal survetements"));
  assert.equal(variantGroupKeyOfRow({ categoryName: "Sport" }), null);
});

// ---- the group must arrive COMPLETE (the write is all-or-nothing per group) -----------------------------

function withSizes(rows: ProductImportRow[], sizes: Array<number | undefined>): ProductImportRow[] {
  return rows.map((row, index) => (sizes[index] === undefined ? row : { ...row, variantGroupSize: sizes[index] }));
}

function previewWithSizes(rows: ProductImportRow[], requireGroupSize = false) {
  const prepared = prepareVariantRows(rows);
  const classified = classifyPreloadedRows(prepared.rows, emptyPreload(), { applyStock: false, creationDefaults: DEFAULTS });
  return finalizeVariantGroups(classified, { problems: prepared.problems, requireGroupSize });
}

test("a group that arrives complete (declared size == lines received) is not blocked", () => {
  const result = previewWithSizes(withSizes(sentRows(ARSENAL), [3, 3, 3]), true);
  assert.deepEqual(result.rows.map((row) => row.status), ["NEW", "NEW", "NEW"]);
  assert.equal(result.groups[0].blocked, false);
});

test("a group short of a line - one that was invalid in the browser, or left for another request - is refused WHOLE", () => {
  // the file has 4 lines in the group; only 3 are sent
  const result = previewWithSizes(withSizes(sentRows(ARSENAL), [4, 4, 4]), true);
  assert.deepEqual(result.rows.map((row) => row.status), ["ERROR", "ERROR", "ERROR"]);
  for (const row of result.rows) {
    assert.equal(row.message, "Groupe incomplet : 3 ligne(s) reçue(s) sur 4 dans le fichier.");
    assert.equal(row.groupBlocked, true);
    assert.equal(isImportableStatus(row.status), false);
  }
  assert.equal(result.groups[0].blocked, true);
  assert.match(result.groups[0].reason!, /Groupe incomplet/);
});

test("more lines than the file declares, inconsistent sizes, or a line without size are refused too", () => {
  const rows = sentRows(ARSENAL);
  assert.ok(previewWithSizes(withSizes(rows, [2, 2, 2])).rows.every((row) => row.status === "ERROR" && /3 ligne\(s\) reçue\(s\) sur 2/.test(row.message)));
  assert.ok(previewWithSizes(withSizes(rows, [3, 3, 4])).rows.every((row) => row.message === "Tailles de groupe incohérentes dans la requête."));
  assert.ok(previewWithSizes(withSizes(rows, [3, 3, undefined])).rows.every((row) => row.status === "ERROR" && /Groupe incomplet/.test(row.message)));
});

test("the write requires the size (a modified browser cannot skip the check); the preview may omit it", () => {
  const rows = sentRows(ARSENAL);
  const write = previewWithSizes(rows, true);
  assert.ok(write.rows.every((row) => row.status === "ERROR" && row.message.startsWith("Taille du groupe manquante")));
  const preview = previewWithSizes(rows, false);
  assert.ok(preview.rows.every((row) => row.status === "NEW"), "the preview of the page does not send it yet");
});

test("the size is per group: a complete group is written while an incomplete one of the same request is refused", () => {
  const arsenal = withSizes(sentRows(ARSENAL), [3, 3, 3]);
  const nike = withSizes(sentRows([fileRow("Short Nike", "TAILLE: S"), fileRow("Short Nike", "TAILLE: M")]), [3, 3]);
  const result = previewWithSizes([...arsenal, ...nike.map((row, index) => ({ ...row, excelRow: 10 + index }))], true);
  assert.deepEqual(result.rows.map((row) => row.status), ["NEW", "NEW", "NEW", "ERROR", "ERROR"]);
  assert.deepEqual(result.groups.map((group) => group.blocked), [false, true]);
});

test("variantGroupSize in the row contract: a positive whole number within the file limit", () => {
  const base = { excelRow: 2, reference: "R" };
  assert.equal(productImportRowSchema.parse({ ...base, variantGroupSize: 3 }).variantGroupSize, 3);
  for (const bad of [0, -1, 1.5, 15001]) assert.ok(productImportRowSchema.safeParse({ ...base, variantGroupSize: bad }).error, String(bad));
  assert.equal("variantGroupSize" in productImportRowSchema.parse(base), false, "a historical line is unchanged");
});

// ---- D2: what the database says about a variant (identity, ordinary products, other references) --------------

const shortS = () => sentRows([fileRow("Short", "TAILLE: S")])[0];
const storedProduct = (row: ProductImportRow, over: Record<string, unknown> = {}) => ({
  id: "p-stored",
  reference: row.reference,
  name: row.name!,
  defaultSupplierId: "sup1",
  defaultSupplierName: "Fournisseur 1",
  categoryId: "cat1",
  categoryName: "Sport",
  purchasePrice: 83.33,
  salePrice: 125,
  taxRate: 20,
  ...over,
});
const identityOf = (row: ProductImportRow) => ({ groupKey: variantGroupKeyOf(row.variantParentName!), key: variantKeyOf(row.variantAttributes!) });

test("an ORDINARY product (variant fields NULL) that matches reference, designation and category exactly joins the group - as a visible update", () => {
  const row = shortS();
  const result = preview([row], { preload: emptyPreload({ products: [storedProduct(row, { variant: null })] }) });
  assert.equal(result.rows[0].status, "EXISTING_UPDATE", "even though nothing else differs");
  assert.equal(result.rows[0].attachVariant, true);
  assert.equal(result.rows[0].changes.variant.new, "variante TAILLE: S");
  assert.equal(result.rows[0].variantIdentity!.key, "taille=s");
  assert.equal(result.groups[0].blocked, false);
});

test("an ordinary product that does NOT match exactly (designation, category, barcode) is a CONFLICT and blocks the group", () => {
  const row = shortS();
  const withBarcode = { ...row, barcode: "611", reference: prepareVariantRows([{ ...row, barcode: "611" }]).rows[0].reference, referenceSource: "barcode" as const };
  const cases: Array<[ProductImportRow, Record<string, unknown>, RegExp]> = [
    [row, { name: "Short - s" }, /désignation « Short - s »/],
    [row, { categoryId: "cat2", categoryName: "Plage" }, /catégorie « Plage »/],
    [withBarcode, { barcode: "999" }, /code-barres 999/],
  ];
  for (const [target, over, expected] of cases) {
    const result = preview([target], { preload: emptyPreload({ products: [storedProduct(target, { variant: null, ...over })] }) });
    assert.equal(result.rows[0].status, "CONFLICT", JSON.stringify(over));
    assert.match(result.rows[0].message, expected);
    assert.equal(result.rows[0].attachVariant, undefined);
  }
});

test("the same variant again (same identity): a normal update, a different spelling of the designation is allowed, a category change is not", () => {
  const row = shortS();
  const same = { variant: identityOf(row) };
  assert.equal(preview([row], { preload: emptyPreload({ products: [storedProduct(row, same)] }) }).rows[0].status, "EXISTING_UNCHANGED");
  const respelled = preview([row], { preload: emptyPreload({ products: [storedProduct(row, { ...same, name: "SHORT - S (ancien)" })] }) });
  assert.equal(respelled.rows[0].status, "EXISTING_UPDATE");
  assert.ok(respelled.rows[0].changes.name);
  assert.equal(respelled.rows[0].attachVariant, undefined, "already a variant: nothing to attach");
  const moved = preview([row], { preload: emptyPreload({ products: [storedProduct(row, { ...same, categoryId: "cat2", categoryName: "Plage" })] }) });
  assert.equal(moved.rows[0].status, "CONFLICT");
  assert.match(moved.rows[0].message, /même variante dans une autre catégorie/);
});

test("a reference held by ANOTHER variant, or by a variant when the line is an ordinary product, is a CONFLICT", () => {
  const row = shortS();
  const other = preview([row], { preload: emptyPreload({ products: [storedProduct(row, { variant: { groupKey: "short", key: "taille=xl" } })] }) });
  assert.equal(other.rows[0].status, "CONFLICT");
  assert.match(other.rows[0].message, /déjà utilisée par une autre variante/);

  // an ordinary product of a variants file (no attributes): its reference is recomputed by the server
  const plain = prepareVariantRows([
    productImportRowSchema.parse({ excelRow: 7, reference: "x", name: "Ballon", categoryName: "Sport", referenceSource: "generated", purchasePriceTTC: 30, salePriceTTC: 50 }),
  ]).rows[0];
  const real = preview([plain], { preload: emptyPreload({ products: [storedProduct(plain, { variant: { groupKey: "ballon", key: "taille=s" } })] }) });
  assert.equal(real.rows[0].status, "CONFLICT");
  assert.match(real.rows[0].message, /une variante existante/);
});

test("the variant exists under ANOTHER reference (found by identity): a conflict that names it - nothing is created next to it", () => {
  const row = shortS();
  const identity = identityOf(row);
  const owners = new Map([[variantIdentityKey("cat1", identity.groupKey, identity.key), { id: "p-old", reference: "ANCIENNE-REF", name: "Short - S" }]]);
  const result = preview([row], { preload: emptyPreload({ variantOwners: owners }) });
  assert.equal(result.rows[0].status, "CONFLICT");
  assert.match(result.rows[0].message, /existe déjà sous la référence ANCIENNE-REF \(« Short - S »\)/);
  assert.equal(result.groups[0].blocked, true);
  // another category is another identity: no conflict
  const elsewhere = new Map([[variantIdentityKey("cat-other", identity.groupKey, identity.key), { id: "p-old", reference: "ANCIENNE-REF", name: "Short - S" }]]);
  assert.equal(preview([row], { preload: emptyPreload({ variantOwners: elsewhere }) }).rows[0].status, "NEW");
});

test("the expected size counts the lines the browser reports refused: short only when a line is hidden from BOTH the request and the report", () => {
  const rows = withSizes(sentRows(ARSENAL).slice(0, 2), [3, 3]); // the file has 3 lines in the group; 2 are sent
  const hidden = previewWithSizes(rows, true);
  assert.ok(hidden.rows.every((row) => /Groupe incomplet : 2 ligne\(s\) reçue\(s\) sur 3/.test(row.message)));
  // the third line is reported as refused: received = 2 + 1, the group is complete - and blocked BY that reported line
  const prepared = prepareVariantRows(rows);
  const finalize = (externalErrors: Array<{ groupKey: string; excelRow: number; message: string }>) =>
    finalizeVariantGroups(classifyPreloadedRows(prepared.rows, emptyPreload(), { applyStock: false, creationDefaults: DEFAULTS }), {
      problems: prepared.problems,
      requireGroupSize: true,
      externalErrors,
    });
  const reported = finalize([{ groupKey: groupKey("Arsenal Survêtements"), excelRow: 9, message: "Valeur de variante mal formée." }]);
  assert.ok(reported.rows.every((row) => /^Groupe bloqué \(ligne 9 : Valeur de variante mal formée\./.test(row.message)));
  // the same line reported twice counts once
  const twice = finalize([
    { groupKey: groupKey("Arsenal Survêtements"), excelRow: 9, message: "x" },
    { groupKey: groupKey("Arsenal Survêtements"), excelRow: 9, message: "x" },
  ]);
  assert.ok(twice.rows.every((row) => /^Groupe bloqué \(ligne 9/.test(row.message)), "2 sent + 1 reported line = 3 declared: complete, blocked by the report");
});
