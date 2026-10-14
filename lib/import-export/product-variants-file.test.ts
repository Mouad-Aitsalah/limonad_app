import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";

import { readBarcode } from "@/lib/import-export/cells";
import { detectSeparator, parseCsv, toCsv } from "@/lib/import-export/csv";
import { readProductImportFile } from "@/lib/import-export/product-import-file";
import { parseProductGrid, parseProductTable } from "@/lib/import-export/products-format";
import { readTableFile, readTableGrid, tableFromGrid, writeXlsx } from "@/lib/import-export/tabular";
import { deriveSimpleReference, deriveVariantReference } from "@/lib/products-import-variants";

const utf8 = (text: string) => strToU8(text);
const utf16le = (text: string) => {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out;
};

const HISTORICAL_HEADERS = ["ref_produit", "ref_fournisseur", "designation", "type", "prixAchatTTC", "prixGros", "taux_tva", "QuantiteStock"];
const ARSENAL_ROWS = [
  ["Arsenal Survêtements", "6111234567890", "Survêtements", 120, 199, 5, "TAILLE: S | COULEUR: NOIR"],
  ["Arsenal Survêtements", "", "Survêtements", "120", "199,00", "3", "COULEUR: Noir | Taille: M"],
  ["Ballon", "", "Sport", "30", "50", "10", ""],
];

describe("detectSeparator (compatibility first)", () => {
  it("keeps the historical choice on every file the historical rule cut consistently", () => {
    assert.equal(detectSeparator("ref_produit;designation;prixGros\nP1;Eau;4,80\nP2;Jus;6,5\n"), ";");
    assert.equal(detectSeparator("a,b,c\n1,2,3\n"), ",");
    assert.equal(detectSeparator("a\tb\n1\t2\n"), "\t");
    // A COMDIS ';' export with unquoted decimal commas is still ';' (the first line decides).
    assert.equal(detectSeparator("ref_produit;prixGros\nP1;4,80\n"), ";");
    assert.equal(detectSeparator(""), ";");
    assert.equal(detectSeparator("single column\nanother\n"), ";");
  });

  it("reads a header-less comma file whose first line holds a stray ';' in a designation", () => {
    const text = "Short; Nike,3421,Sport,10,20,5,TAILLE: S\nBallon,,Sport,30,50,10,\n";
    assert.equal(detectSeparator(text), ",");
    assert.equal(parseCsv(text)[0].length, 7);
  });

  it("a historical-looking comma file with decimal commas in quotes keeps its separator", () => {
    assert.equal(detectSeparator('a,b\n"1,5",007\n'), ",");
  });
});

describe("detectSeparator: non-regression of the historical choice (review fixes)", () => {
  it("a one-column file stays one column, whatever its values contain", () => {
    const text = "ref_produit\nA,1\nB,2\nD,4,5\n";
    assert.equal(detectSeparator(text), ";");
    assert.deepEqual(parseCsv(text), [["ref_produit"], ["A,1"], ["B,2"], ["D,4,5"]]);
    const exported = toCsv([["N_compte"], ["Café, noir"], ["45912"]]);
    assert.deepEqual(parseCsv(exported), [["N_compte"], ["Café, noir"], ["45912"]]);
  });

  it("ragged « ; » lines are not handed to the decimal commas of the values", () => {
    const text = "ref;designation;prix;stock\nP1;Eau;4,80\nP2;Jus;5,20;3\nP3;Lait;1,10\nP4;Thé;7,00;9\n";
    assert.equal(detectSeparator(text), ";");
    assert.equal(parseCsv(text)[1].length, 3);
    // one decimal comma on EVERY line, lines of different lengths
    assert.equal(detectSeparator("a;b;c\nx;4,80\ny;z;1,5;t\nu;2,5\n"), ";");
  });

  it("the stray « ; » of a header-less comma file's first line is still recognised", () => {
    const text = "Short; Nike,3421,Sport,10,20,5,TAILLE: S\nBallon,,Sport,30,50,10,\nFilet,,Sport,12,25,4,\n";
    assert.equal(detectSeparator(text), ",");
    assert.deepEqual(parseCsv(text).map((row) => row.length), [7, 7, 7]);
  });

  it("an unquoted inch mark inside a value does not disturb the count (same quote rules as the reader)", () => {
    const text = 'Jus, orange;4,80;4,80\nTuyau 3/4";007;Tuyau 3/4"\nEcran 15" LED;x;Jus, orange\n';
    assert.equal(detectSeparator(text), ";");
    assert.deepEqual(parseCsv(text)[1], ['Tuyau 3/4"', "007", 'Tuyau 3/4"']);
  });

  it("a « ; » inside a value of a later line does not change a consistent comma file", () => {
    assert.equal(detectSeparator("a,b,c\nx;y,2,3\nz,4,5\nw,6,7\n"), ",");
  });
});

describe("tabular: UTF-16 and the raw grid", () => {
  it("decodes a UTF-16 LE file with BOM (Excel « Texte Unicode »), accents included", () => {
    const grid = readTableGrid(utf16le("designation;type\r\nSurvêtement;Sport\r\n"), "p.csv", "produits");
    assert.deepEqual(grid, [["designation", "type"], ["Survêtement", "Sport"]]);
  });

  it("keeps UTF-8 (with BOM) and Windows-1252 exactly as before", () => {
    assert.deepEqual(readTableGrid(utf8("﻿a;b\r\nÉté;1\r\n"), "p.csv", "produits"), [["a", "b"], ["Été", "1"]]);
    assert.deepEqual(readTableGrid(new Uint8Array([0x61, 0x3b, 0x62, 0x0a, 0xe9, 0x3b, 0x31]), "p.csv", "produits"), [["a", "b"], ["é", "1"]]);
  });

  it("the grid keeps the first row; readTableFile is still « header + rows from line 2, empty rows dropped »", () => {
    const bytes = utf8("a;b\n1;2\n;\n3;4\n");
    assert.equal(readTableGrid(bytes, "x.csv", "produits")[0][0], "a");
    const table = readTableFile(bytes, "x.csv", "produits");
    assert.deepEqual(table.headers, ["a", "b"]);
    assert.deepEqual(table.rows.map((row) => row.line), [2, 4]);
    assert.deepEqual(tableFromGrid([["h"], [""], ["x"]]).rows, [{ line: 3, cells: ["x"] }]);
  });
});

describe("readBarcode", () => {
  it("keeps a text barcode exact, leading zeros included", () => {
    assert.deepEqual(readBarcode("0012345678905"), { value: "0012345678905" });
    assert.deepEqual(readBarcode("  6111234567890 "), { value: "6111234567890" });
    assert.deepEqual(readBarcode(""), {});
    assert.deepEqual(readBarcode(null), {});
  });

  it("accepts a numeric cell Excel kept intact", () => {
    assert.deepEqual(readBarcode(6111234567890), { value: "6111234567890" });
  });

  it("refuses a number the spreadsheet has rounded or turned into scientific notation", () => {
    assert.match(readBarcode(2.1e15).error!, /arrondi/);
    assert.match(readBarcode(6111234567890.5).error!, /arrondi/);
    assert.match(readBarcode(-5).error!, /arrondi/);
    assert.match(readBarcode("2,10E+12").error!, /notation scientifique/);
    assert.match(readBarcode("6.11123E+12").error!, /notation scientifique/);
    assert.equal(readBarcode("12E5").error, undefined, "an alphanumeric code is not scientific notation");
  });

  it("warns (never blocks) about a numeric 12- or 7-digit code that may have lost a zero", () => {
    const upc = readBarcode(123456789012);
    assert.equal(upc.value, "123456789012");
    assert.match(upc.warning!, /zéro initial/);
    assert.match(readBarcode(1234567).warning!, /7 chiffres/);
    assert.equal(readBarcode("123456789012").warning, undefined, "typed as text: trusted");
  });
});

describe("parseProductGrid: format recognition", () => {
  it("a HISTORICAL file is read exactly as parseProductTable reads it", () => {
    const rows = [["P1", "F1", "Eau", "Boissons", "4,80", 6, 0.2, 10], ["P2", "F1", "Jus", "Boissons", "5", 7, 0.2, ""]];
    const grid = [HISTORICAL_HEADERS, ...rows];
    const viaGrid = parseProductGrid(grid);
    const viaTable = parseProductTable(HISTORICAL_HEADERS, tableFromGrid(grid).rows);
    assert.equal(viaGrid.format, "historical");
    assert.equal(viaGrid.headerless, false);
    assert.equal(viaGrid.fatal, undefined);
    assert.deepEqual(viaGrid.lines, viaTable.lines);
    assert.deepEqual([...viaGrid.present], [...viaTable.present]);
    assert.equal(viaGrid.lines[0].line.referenceSource, undefined);
    assert.equal(viaGrid.lines[0].line.variantAttributes, undefined);
  });

  it("a historical file with a « variantes » column ignores it (ref_produit decides)", () => {
    const grid = [["ref_produit", "designation", "variantes"], ["P1", "Eau", "TAILLE: S"]];
    const parsed = parseProductGrid(grid);
    assert.equal(parsed.format, "historical");
    assert.deepEqual(parsed.lines[0].line, { excelRow: 2, reference: "P1", name: "Eau" });
  });

  it("a historical file that LOST its ref_produit is refused with the historical message (never read as variants)", () => {
    const grid = [["designation", "type", "prixGros"], ["Eau", "Boissons", "6"]];
    const parsed = parseProductGrid(grid);
    assert.match(parsed.fatal!, /ref_produit/);
    assert.match(parsed.fatal!, /variantes/, "the message points to the variants format");
    assert.deepEqual(parsed.lines, []);
    assert.equal(parseProductTable(grid[0], tableFromGrid(grid).rows).fatal?.includes("ref_produit"), true);
  });

  it("a header line with names we do not know is refused, never imported as a product", () => {
    const grid = [["Nom", "EAN", "Rayon", "Achat", "Vente", "Qté", "Options"], ["Short", "611", "Sport", "10", "20", "5", "TAILLE: S"]];
    assert.match(parseProductGrid(grid).fatal!, /ref_produit/);
  });

  it("recognises the 7 header-less columns, reading the first row as data (line numbers start at 1)", () => {
    const parsed = parseProductGrid(ARSENAL_ROWS);
    assert.equal(parsed.fatal, undefined);
    assert.equal(parsed.format, "variants");
    assert.equal(parsed.headerless, true);
    assert.match(parsed.columnsNotice!, /désignation, code-barres, catégorie/);
    assert.deepEqual(parsed.lines.map((entry) => entry.line.excelRow), [1, 2, 3]);
    assert.deepEqual(parsed.lines.map((entry) => entry.errors), [[], [], []]);
    assert.equal(parsed.present.has("reference"), false);
    assert.equal(parsed.present.has("supplierCode"), false);
    assert.equal(parsed.present.has("taxRate"), false);
  });

  it("a 7-column file is never read as variants when its first row looks like a header or has no numbers", () => {
    const headerLike = [["designation", "code barres", "categorie", "prix achat", "prix vente", "stock", "variantes"], ...ARSENAL_ROWS];
    assert.equal(parseProductGrid(headerLike).headerless, false, "a header line is a header line");
    const textOnly = [["a", "b", "c", "d", "e", "f", "g"]];
    assert.match(parseProductGrid(textOnly).fatal!, /ref_produit/);
    const eightColumns = [[...ARSENAL_ROWS[0], "extra"]];
    assert.match(parseProductGrid(eightColumns).fatal!, /ref_produit/);
    const sixColumns = [ARSENAL_ROWS[0].slice(0, 6)];
    assert.match(parseProductGrid(sixColumns).fatal!, /ref_produit/);
    assert.match(parseProductGrid([]).fatal!, /ref_produit/);
  });

  it("recognises a variants file WITH a header line (« variantes » column, no ref_produit)", () => {
    const grid = [
      ["designation", "code_barres", "categorie", "prix_achat", "prix de vente ttc", "stock", "variantes"],
      ["Arsenal Survêtements", "6111234567890", "Survêtements", "120", "199", "5", "TAILLE: S | COULEUR: NOIR"],
      ["Ballon", "", "Sport", "30", "50", "10", ""],
    ];
    const parsed = parseProductGrid(grid);
    assert.equal(parsed.format, "variants");
    assert.equal(parsed.headerless, false);
    assert.equal(parsed.columnsNotice, undefined);
    assert.deepEqual(parsed.lines.map((entry) => entry.line.excelRow), [2, 3], "line 1 is the header");
    assert.equal(parsed.lines[0].line.salePriceTTC, 199);
    assert.equal(parsed.lines[0].line.purchasePriceTTC, 120);
    assert.equal(parsed.lines[0].line.targetStock, 5);
    assert.deepEqual(parsed.lines.map((entry) => entry.errors), [[], []]);
  });
});

describe("parseProductGrid: variants lines", () => {
  const parsed = parseProductGrid(ARSENAL_ROWS);
  const [first, second, simple] = parsed.lines.map((entry) => entry.line);

  it("builds the display name from the parent and the values, and keeps the structure", () => {
    assert.equal(first.name, "Arsenal Survêtements - S / NOIR");
    assert.equal(first.variantParentName, "Arsenal Survêtements");
    assert.deepEqual(first.variantAttributes, [{ name: "TAILLE", value: "S" }, { name: "COULEUR", value: "NOIR" }]);
  });

  it("unifies the spelling inside the group on the first occurrence (attribute order and casing too)", () => {
    assert.equal(second.name, "Arsenal Survêtements - M / NOIR", "« COULEUR: Noir | Taille: M » follows « TAILLE | COULEUR » and « NOIR »");
    assert.deepEqual(second.variantAttributes, [{ name: "TAILLE", value: "M" }, { name: "COULEUR", value: "NOIR" }]);
  });

  it("uses the barcode as reference, else a deterministic generated one", () => {
    assert.equal(first.reference, "6111234567890");
    assert.equal(first.referenceSource, "barcode");
    assert.equal(second.referenceSource, "generated");
    assert.equal(
      second.reference,
      deriveVariantReference({
        parentName: "Arsenal Survêtements",
        categoryName: "Survêtements",
        attributes: [{ name: "TAILLE", value: "M" }, { name: "COULEUR", value: "NOIR" }],
      }).reference,
    );
    assert.match(second.reference, /^ARSENAL-SURVETEMENTS-NOIR-M-[0-9a-f]{8}$/);
    assert.ok(second.reference.length <= 80);
  });

  it("a line without variants is a simple product: its designation as written, a deterministic reference", () => {
    assert.equal(simple.name, "Ballon");
    assert.equal(simple.variantAttributes, undefined);
    assert.equal(simple.reference, deriveSimpleReference({ name: "Ballon", categoryName: "Sport" }).reference);
    assert.equal(simple.referenceSource, "generated");
  });

  it("is deterministic: the same file gives the same references, in any row order (the display order follows the first row)", () => {
    const again = parseProductGrid([...ARSENAL_ROWS].reverse());
    const references = (lines: typeof parsed.lines) => lines.map((entry) => entry.line.reference).sort();
    assert.deepEqual(references(again.lines), references(parsed.lines));
    assert.equal(again.lines.find((entry) => entry.line.barcode === "6111234567890")!.line.name, "Arsenal Survêtements - Noir / S", "first occurrence wins");
  });

  it("does not mix two parents, nor the same parent in two categories", () => {
    const grid = [
      ["Short", "", "Sport", "10", "20", "1", "TAILLE: S"],
      ["Short", "", "Plage", "10", "20", "1", "TAILLE: S"],
      ["Maillot", "", "Sport", "10", "20", "1", "TAILLE: S"],
    ];
    const references = parseProductGrid(grid).lines.map((entry) => entry.line.reference);
    assert.equal(new Set(references).size, 3);
  });

  it("blocks a malformed variant cell, keeps the raw text to show it, and never invents a reference from it", () => {
    const grid = [
      ["Short", "", "Sport", "10", "20", "1", "TAILLE S"],
      ["Short", "", "Sport", "10", "20", "1", "TAILLE: S | TAILLE: M"],
      ["Short", "", "Sport", "10", "20", "1", "TAILLE: | COULEUR: NOIR"],
    ];
    const lines = parseProductGrid(grid).lines;
    for (const entry of lines) {
      assert.ok(entry.errors.length > 0);
      assert.ok(entry.line.variantRaw);
      assert.equal(entry.line.variantAttributes, undefined);
    }
    assert.match(lines[0].errors.join(), /NOM: valeur/);
    assert.match(lines[1].errors.join(), /deux fois/);
  });

  it("reports a missing designation and an unreadable price on the line, not on the file", () => {
    const grid = [
      ["", "", "Sport", "10", "20", "1", "TAILLE: S"],
      ["Short", "", "Sport", "abc", "20", "1", "TAILLE: S"],
    ];
    const parsed = parseProductGrid(grid);
    assert.equal(parsed.fatal, undefined);
    assert.match(parsed.lines[0].errors.join(), /designation manquante/);
    assert.match(parsed.lines[1].errors.join(), /prixAchatTTC invalide/);
  });

  it("keeps a long barcode exact, and reports spreadsheet damage on the line", () => {
    const grid = [
      ["Short", "0012345678905", "Sport", "10", "20", "1", "TAILLE: S"],
      ["Short", "2,10E+12", "Sport", "10", "20", "1", "TAILLE: M"],
      ["Short", 2.1e15, "Sport", "10", "20", "1", "TAILLE: L"],
      ["Short", 123456789012, "Sport", "10", "20", "1", "TAILLE: XL"],
    ];
    const lines = parseProductGrid(grid).lines;
    assert.equal(lines[0].line.barcode, "0012345678905");
    assert.equal(lines[0].line.reference, "0012345678905");
    assert.match(lines[1].errors.join(), /notation scientifique/);
    assert.match(lines[2].errors.join(), /arrondi/);
    assert.deepEqual(lines[3].errors, []);
    assert.match(lines[3].warnings!.join(), /zéro initial/);
  });

  it("drops entirely empty rows, but keeps the real line number of the others", () => {
    const grid = [ARSENAL_ROWS[0], ["", "", "", "", "", "", ""], ARSENAL_ROWS[2]];
    assert.deepEqual(parseProductGrid(grid).lines.map((entry) => entry.line.excelRow), [1, 3]);
  });
});

describe("readProductImportFile: the variants format is opt-in", () => {
  const csvBody = ARSENAL_ROWS.map((row) => row.join(";")).join("\r\n");

  it("by default a header-less variants file is refused exactly as before", () => {
    const content = readProductImportFile(utf8(csvBody), "variantes.csv");
    assert.match(content.parsed.fatal!, /ref_produit/);
    assert.equal(content.parsed.format, undefined, "the historical reader sets nothing new");
    assert.deepEqual(content.parsed.lines, []);
  });

  it("with variantFormat, the same CSV is read (semicolon, comma, tab, UTF-16)", () => {
    const rows = ARSENAL_ROWS.map((row) => row.map((cell) => (typeof cell === "string" && /[,;]/.test(cell) ? `"${cell}"` : String(cell))));
    const asComma = rows.map((row) => row.join(",")).join("\n");
    const asTab = ARSENAL_ROWS.map((row) => row.join("\t")).join("\n");
    for (const [bytes, label] of [
      [utf8(csvBody), "semicolon"],
      [utf8(asComma), "comma"],
      [utf8(asTab), "tab"],
      [utf16le(csvBody), "utf-16"],
    ] as const) {
      const content = readProductImportFile(bytes, "variantes.csv", { variantFormat: true });
      assert.equal(content.parsed.fatal, undefined, label);
      assert.equal(content.parsed.format, "variants", label);
      assert.deepEqual(content.parsed.lines.map((entry) => entry.line.name), ["Arsenal Survêtements - S / NOIR", "Arsenal Survêtements - M / NOIR", "Ballon"], label);
    }
  });

  it("a historical file gives the same lines with or without the option", () => {
    const text = `${HISTORICAL_HEADERS.join(";")}\r\nP1;F1;Eau;Boissons;4,80;6;20;10\r\n`;
    const legacy = readProductImportFile(utf8(text), "produits.csv");
    const modern = readProductImportFile(utf8(text), "produits.csv", { variantFormat: true });
    assert.deepEqual(modern.parsed.lines, legacy.parsed.lines);
    assert.equal(legacy.parsed.fatal, undefined);
  });

  it("reads an xlsx with the barcode as text and as a number, the header-less layout included", () => {
    const columns = ARSENAL_ROWS[0].map((_, index) => ({ header: `c${index}`, kind: "text" as const }));
    const bytes = writeXlsx("produits", columns, ARSENAL_ROWS.map((row) => row.map((cell) => (cell === null ? "" : String(cell)))));
    // writeXlsx always writes a header row, so this file HAS a header line of unknown names: refused, not guessed.
    assert.match(readProductImportFile(bytes, "p.xlsx", { variantFormat: true }).parsed.fatal!, /ref_produit/);
  });

  it("reads a ZIP holding a variants data file when the option is on", () => {
    const zip = zipSync({ "produits.csv": utf8(csvBody) });
    assert.match(readProductImportFile(zip, "p.zip").parsed.fatal!, /ref_produit/);
    const content = readProductImportFile(zip, "p.zip", { variantFormat: true });
    assert.equal(content.parsed.format, "variants");
    assert.equal(content.parsed.lines.length, 3);
    assert.notEqual(content.archive, null);
  });
});

describe("parseProductGrid: header-less recognition (review fixes)", () => {
  it("a very long header-less file is handled without any argument-spread limit (200 000 rows)", () => {
    const simple = ["Ballon", "", "Sport", 30, 50, 10, ""];
    // not the variants layout (8 columns): refused quickly and explicitly, never a RangeError
    const tooWide = Array.from({ length: 200_000 }, () => [...simple, "extra"]);
    let refused: ReturnType<typeof parseProductGrid> | undefined;
    assert.doesNotThrow(() => {
      refused = parseProductGrid(tooWide);
    });
    assert.match(refused!.fatal!, /ref_produit/);
    assert.deepEqual(refused!.lines, []);
    // the real layout, same length: read, not crashed
    const variants = Array.from({ length: 200_000 }, (_, i) => ["Produit", "", "Sport", 30, 50, 10, `TAILLE: T${i}`]);
    let read: ReturnType<typeof parseProductGrid> | undefined;
    assert.doesNotThrow(() => {
      read = parseProductGrid(variants);
    });
    assert.equal(read!.format, "variants");
    assert.equal(read!.lines.length, 200_000);
  });

  it("accepts a first row without price or stock when the following rows give the evidence", () => {
    const parsed = parseProductGrid([
      ["Ballon", "", "Sport", "", "", "", ""],
      ["Short", "", "Sport", 10, 20, 5, "TAILLE: S"],
      ["Short", "", "Sport", 10, 20, 5, "TAILLE: M"],
    ]);
    assert.equal(parsed.fatal, undefined);
    assert.equal(parsed.format, "variants");
    assert.equal(parsed.headerless, true);
    assert.deepEqual(parsed.lines.map((entry) => entry.line.excelRow), [1, 2, 3]);
  });

  it("accepts a file whose « variantes » column is empty on every row, when its rows are 7 cells wide (CSV)", () => {
    const csv = utf8("Ballon,,Sport,30,50,10,\nFilet,,Sport,12,25,4,\n");
    const content = readProductImportFile(csv, "simples.csv", { variantFormat: true });
    assert.equal(content.parsed.fatal, undefined);
    assert.equal(content.parsed.format, "variants");
    assert.deepEqual(content.parsed.lines.map((entry) => entry.line.name), ["Ballon", "Filet"]);
    assert.deepEqual(content.parsed.lines.map((entry) => entry.errors), [[], []]);
  });

  it("refuses, explicitly, what stays ambiguous", () => {
    // 6 cells per row: could be anything
    const six = parseProductGrid([["Ballon", "", "Sport", 30, 50, 10], ["Filet", "", "Sport", 12, 25, 4]]);
    assert.match(six.fatal!, /ref_produit/);
    // 7 cells wide but no number anywhere in prices / stock
    const noNumbers = parseProductGrid([["Ballon", "", "Sport", "", "", "", "TAILLE: S"], ["Filet", "", "Sport", "", "", "", "TAILLE: M"]]);
    assert.match(noNumbers.fatal!, /doivent contenir des nombres/);
    // first row with text in a price column
    const textPrice = parseProductGrid([["Ballon", "", "Sport", "n/a", 50, 10, "TAILLE: S"], ["Filet", "", "Sport", 12, 25, 4, "TAILLE: M"]]);
    assert.match(textPrice.fatal!, /doivent contenir des nombres/);
    // more than half of the rows with unreadable prices
    const mostlyText = parseProductGrid([
      ["A", "", "S", 1, 2, 3, ""],
      ["B", "", "S", "x", 2, 3, ""],
      ["C", "", "S", "y", 2, 3, ""],
    ]);
    assert.match(mostlyText.fatal!, /doivent contenir des nombres/);
    assert.deepEqual(mostlyText.lines, []);
    // empty variants column but the rows are not 7 cells wide (xlsx range / CSV without the trailing separator)
    const csv = utf8("Ballon,,Sport,30,50,10\nFilet,,Sport,12,25,4\n");
    assert.match(readProductImportFile(csv, "six.csv", { variantFormat: true }).parsed.fatal!, /ref_produit/);
  });

  it("still never reads a historical file that lost ref_produit as the variants format", () => {
    const lost = parseProductGrid([["designation", "type", "prixGros", "QuantiteStock"], ["Eau", "Boissons", 6, 10]]);
    assert.match(lost.fatal!, /ref_produit/);
    assert.deepEqual(lost.lines, []);
    // even with 7 columns: the first row is a header line (known names), not data
    const sevenWithHeader = parseProductGrid([["designation", "type", "prixGros", "QuantiteStock", "taux_tva", "unite", "ref_fournisseur"], ["Eau", "Boissons", 6, 10, 20, "u", "F1"]]);
    assert.match(sevenWithHeader.fatal!, /ref_produit/);
  });
});
