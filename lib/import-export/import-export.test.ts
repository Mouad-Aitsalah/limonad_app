import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";

import {
  ACCOUNT_COLUMNS,
  accountExportCells,
  orderedAccountColumns,
  parseAccountTable,
  type AccountExportRow,
} from "@/lib/import-export/accounts-format";
import { readCoordinates, readDecimal, readInteger, readDate, readBoolean, headerKey } from "@/lib/import-export/cells";
import { guardText, parseCsv, toCsv, unguardText } from "@/lib/import-export/csv";
import { runAccountsExport, runProductsExport, type FetchJson } from "@/lib/import-export/export-runner";
import {
  base64ToBytes,
  bytesToBase64,
  checkPhotoBytes,
  checkPhotoDataUrl,
  detectPhotoMime,
  isPortablePhotoUrl,
  MAX_PHOTO_BYTES,
  photoArchivePath,
  photoDataUrl,
  storedPhotoBytes,
} from "@/lib/import-export/images";
import { photoUploadBatches, readProductImportFile } from "@/lib/import-export/product-import-file";
import {
  PRODUCT_COLUMNS,
  orderedProductColumns,
  parseProductTable,
  productExportCells,
  type ProductExportRow,
} from "@/lib/import-export/products-format";
import { readTableFile, TableFileError, writeCsv, writeXlsx, type TableRow } from "@/lib/import-export/tabular";
import { buildArchive, readArchive, safeArchivePath } from "@/lib/import-export/zip";

const PNG = base64ToBytes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const rowsOf = (cells: unknown[][]): TableRow[] => cells.map((row, index) => ({ line: index + 2, cells: row }));

describe("CSV", () => {
  it("writes BOM + ';' + quoting, and reads it back exactly (quotes, separators, line breaks, accents)", () => {
    const rows = [
      ["ref_produit", "designation", "description"],
      ["A;1", 'Eau "Sidi Ali" 1,5L', "ligne 1\nligne 2"],
      ["  espace", "Épicé à l'œuf", ""],
    ];
    const text = toCsv(rows);
    assert.ok(text.startsWith("\uFEFF"));
    assert.deepEqual(parseCsv(text), rows);
  });

  it("detects ',' and tab separated files, never splits inside quotes, keeps '007' as text", () => {
    assert.deepEqual(parseCsv('a,b\n"1,5",007\n'), [["a", "b"], ["1,5", "007"]]);
    assert.deepEqual(parseCsv("a\tb\r\nx\ty"), [["a", "b"], ["x", "y"]]);
    assert.deepEqual(parseCsv("a;b\n\n1;2\n"), [["a", "b"], ["1", "2"]], "empty lines skipped");
  });

  it("guards formulas on export and gives back the original text on import", () => {
    for (const value of ["=SUM(A1)", "+212600", "-5 promo", "@cmd"]) {
      assert.equal(guardText(value).startsWith("'"), true);
      assert.equal(unguardText(guardText(value)), value);
    }
    assert.equal(guardText("Normal"), "Normal");
    assert.equal(unguardText("'apostrophe normale"), "'apostrophe normale");
  });
});

describe("cells", () => {
  it("reads decimals with comma or point, thousands separators, and refuses garbage", () => {
    assert.equal(readDecimal("33,5731234"), 33.5731234);
    assert.equal(readDecimal("33.5731234"), 33.5731234);
    assert.equal(readDecimal("1 234,56"), 1234.56);
    assert.equal(readDecimal("1.234,56"), 1234.56);
    assert.equal(readDecimal("1,234.56"), 1234.56);
    assert.equal(readDecimal("-7,6198"), -7.6198);
    assert.equal(readDecimal("20%"), 20);
    assert.equal(readDecimal(12.5), 12.5);
    assert.equal(readDecimal(""), undefined);
    assert.equal(readDecimal("   "), undefined);
    assert.equal(readDecimal(null), undefined);
    for (const bad of ["abc", "1,2,3", "1.2.3", "12a"]) assert.equal(readDecimal(bad), null, bad);
    assert.equal(readInteger("12"), 12);
    assert.equal(readInteger("12,5"), null);
  });

  it("reads dates and booleans", () => {
    assert.equal(readDate("2024-03-05"), "2024-03-05");
    assert.equal(readDate("05/03/2024"), "2024-03-05");
    assert.equal(readDate(45356), "2024-03-05");
    assert.equal(readDate("2024-02-30"), null);
    assert.equal(readBoolean("Oui"), true);
    assert.equal(readBoolean("non"), false);
    assert.equal(readBoolean("peut-être"), null);
    assert.equal(headerKey("N° compte"), headerKey("N_compte"));
  });

  it("GPS: both or none, bounds, 7 decimals, named columns only", () => {
    assert.deepEqual(readCoordinates("", ""), { kind: "absent" });
    assert.deepEqual(readCoordinates(undefined, undefined), { kind: "absent" });
    assert.deepEqual(readCoordinates("33,5731234", "-7,5898341"), { kind: "value", latitude: 33.5731234, longitude: -7.5898341 });
    assert.deepEqual(readCoordinates(33.57312345678, -7.5), { kind: "value", latitude: 33.5731235, longitude: -7.5 });
    assert.equal(readCoordinates("33.5", "").kind, "error");
    assert.equal(readCoordinates("", "-7.5").kind, "error");
    assert.match((readCoordinates("95", "10") as { message: string }).message, /Latitude hors limites/);
    assert.match((readCoordinates("10", "-181") as { message: string }).message, /Longitude hors limites/);
    assert.match((readCoordinates("abc", "10") as { message: string }).message, /Latitude invalide/);
    // a longitude-like value in the Latitude column is refused, never swapped
    assert.equal(readCoordinates("-120", "33").kind, "error");
  });
});

describe("photos", () => {
  it("detects the format from the bytes, not the name", () => {
    assert.equal(detectPhotoMime(PNG), "image/png");
    assert.equal(detectPhotoMime(JPEG), "image/jpeg");
    assert.equal(detectPhotoMime(strToU8("GIF89a....")), "image/gif");
    assert.equal(detectPhotoMime(strToU8("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
    assert.equal(detectPhotoMime(strToU8("<svg></svg>")), null);
  });

  it("base64 round trip, data URI checks, size limit", () => {
    const random = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
    assert.deepEqual(base64ToBytes(bytesToBase64(random)), random);
    assert.equal(base64ToBytes("@@@"), null);
    const url = photoDataUrl(PNG, "image/png");
    const check = checkPhotoDataUrl(url);
    assert.equal(check.ok, true);
    assert.deepEqual(storedPhotoBytes(url)?.bytes, PNG);
    // a declared MIME that lies is ignored: the content decides
    assert.equal((checkPhotoDataUrl(`data:image/gif;base64,${bytesToBase64(PNG)}`) as { mime: string }).mime, "image/png");
    assert.equal(checkPhotoDataUrl(`data:text/html;base64,${bytesToBase64(strToU8("<script>"))}`).ok, false);
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(PNG);
    assert.match((checkPhotoBytes(big) as { message: string }).message, /trop volumineuse/);
    assert.equal(checkPhotoBytes(new Uint8Array()).ok, false);
  });

  it("never treats the app's protected photo route as a public URL", () => {
    assert.equal(isPortablePhotoUrl("https://cdn.example.com/eau.jpg"), true);
    assert.equal(isPortablePhotoUrl("https://limonad-app.vercel.app/api/products/cm123/image?v=1"), false);
    assert.equal(isPortablePhotoUrl("/api/products/cm123/image"), false);
    assert.equal(isPortablePhotoUrl("javascript:alert(1)"), false);
  });

  it("archive names: file-safe, special characters, unique", () => {
    const used = new Set<string>();
    assert.equal(photoArchivePath("REF-001", "image/jpeg", used), "photos/REF-001.jpg");
    assert.equal(photoArchivePath("REF/001 é", "image/png", used), "photos/REF_001_e.png");
    assert.equal(photoArchivePath("REF:001 é", "image/png", used), "photos/REF_001_e_2.png", "two references with the same cleaned name never collide");
    assert.equal(photoArchivePath("../../etc", "image/png", used), "photos/etc.png");
    assert.equal(photoArchivePath("***", "image/png", used), "photos/photo.png");
  });

  it("upload batches stay under the size and count limits", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ reference: `R${i}`, mime: "image/png" as const, bytes: PNG }));
    const batches = photoUploadBatches(items, { maxChars: 300, maxItems: 3 });
    assert.ok(batches.every((batch) => batch.length <= 3));
    assert.equal(batches.flat().length, 10);
    assert.ok(batches.every((batch) => batch.length === 1 || batch.reduce((n, item) => n + item.dataUrl.length, 0) <= 300));
  });
});

describe("ZIP safety", () => {
  it("refuses traversal / absolute paths and reports them", () => {
    for (const bad of ["../evil.png", "photos/../../x", "/etc/passwd", "C:/x.png", "a//b", "photos/./x"]) assert.equal(safeArchivePath(bad), null, bad);
    assert.equal(safeArchivePath("photos\\REF.png"), "photos/REF.png");
    const zip = zipSync({ "produits.csv": strToU8("ref_produit\nA"), "../evil.png": PNG, "photos/A.png": PNG, "__MACOSX/._A.png": PNG });
    const content = readArchive(zip, () => MAX_PHOTO_BYTES);
    assert.deepEqual([...content.files.keys()].sort(), ["photos/A.png", "produits.csv"]);
    assert.deepEqual(content.unsafe, ["../evil.png"]);
  });

  it("does not inflate oversized entries and rejects a corrupted archive", () => {
    const zip = buildArchive([{ path: "photos/big.png", data: new Uint8Array(5000) }]);
    const content = readArchive(zip, () => 1000);
    assert.equal(content.files.size, 0);
    assert.deepEqual(content.tooLarge.map((entry) => entry.path), ["photos/big.png"]);
    assert.throws(() => readArchive(strToU8("PK\u0003\u0004 not a zip"), () => 10), /illisible|endommagée/);
  });
});

describe("tabular files", () => {
  it("xlsx and csv round trip: texts stay texts (leading zeros), numbers stay numbers", () => {
    const columns = [
      { header: "N_compte", kind: "text" as const },
      { header: "Tel", kind: "text" as const },
      { header: "Latitude", kind: "number" as const },
    ];
    const rows = [["007", "0612345678", 33.5731234]];
    const x = readTableFile(writeXlsx("Comptes", columns, rows), "f.xlsx", "Comptes");
    assert.deepEqual(x.headers, ["N_compte", "Tel", "Latitude"]);
    assert.deepEqual(x.rows[0].cells, ["007", "0612345678", 33.5731234]);
    const c = readTableFile(writeCsv(columns, rows), "f.csv", "Comptes");
    assert.deepEqual(c.rows[0].cells, ["007", "0612345678", "33,5731234"]);
    assert.equal(readDecimal(c.rows[0].cells[2]), 33.5731234);
  });

  it("finds the historical sheet name, refuses a workbook without it", () => {
    const book = writeXlsx("Autre", [{ header: "a", kind: "text" }], [["1"]]);
    assert.equal(readTableFile(book, "f.xlsx", "produits").rows.length, 1, "a single-sheet workbook is read whatever its name");
    assert.throws(() => readTableFile(strToU8("x"), "f.pdf", "produits"), TableFileError);
  });
});

describe("products format", () => {
  const full: ProductExportRow = {
    reference: "REF/001",
    name: 'Eau "Sidi Ali" 1,5L',
    categoryName: "Boissons",
    supplierCode: "F-01",
    supplierName: "Sidi Ali SA",
    purchasePriceTTC: 4.8,
    salePriceTTC: 6,
    retailPriceTTC: 7.2,
    semiWholesalePriceTTC: 6.6,
    semiWholesaleMinQty: 6,
    wholesaleMinQty: 24,
    taxRate: 20,
    unit: "bouteille",
    barcode: "6111234567890",
    brandName: "Sidi Ali",
    description: "Pack ; promo",
    minimumStock: 12,
    status: "INACTIVE",
    depotStock: -3,
    photo: null,
  };

  it("a HISTORICAL file (the 8 original columns) is read exactly as before", () => {
    const headers = ["ref_produit", "ref_fournisseur", "designation", "type", "prixAchatTTC", "prixGros", "taux_tva", "QuantiteStock"];
    const parsed = parseProductTable(headers, rowsOf([["P1", "F1", "Eau", "Boissons", "4,80", 6, 0.2, 10]]));
    assert.equal(parsed.fatal, undefined);
    assert.deepEqual(parsed.lines[0].line, {
      excelRow: 2,
      reference: "P1",
      supplierCode: "F1",
      name: "Eau",
      categoryName: "Boissons",
      purchasePriceTTC: 4.8,
      salePriceTTC: 6,
      taxRate: 20,
      targetStock: 10,
    });
    // prix_gros spelling accepted
    assert.equal(parseProductTable(["ref_produit", "prix_gros"], rowsOf([["P1", "5"]])).lines[0].line.salePriceTTC, 5);
  });

  it("every exported column comes back identical through the parser (xlsx and csv)", () => {
    const columns = orderedProductColumns(PRODUCT_COLUMNS.map((column) => column.key));
    const cells = [productExportCells(full, columns, "photos/REF_001.png")];
    for (const [bytes, name] of [
      [writeXlsx("produits", columns, cells), "p.xlsx"],
      [writeCsv(columns, cells), "p.csv"],
    ] as const) {
      const table = readTableFile(bytes, name, "produits");
      const { lines } = parseProductTable(table.headers, table.rows);
      assert.deepEqual(lines[0].errors, [], name);
      assert.deepEqual(
        { ...lines[0].line, excelRow: 0 },
        {
          excelRow: 0,
          reference: "REF/001",
          name: 'Eau "Sidi Ali" 1,5L',
          categoryName: "Boissons",
          supplierCode: "F-01",
          supplierName: "Sidi Ali SA",
          purchasePriceTTC: 4.8,
          salePriceTTC: 6,
          retailPriceTTC: 7.2,
          semiWholesalePriceTTC: 6.6,
          semiWholesaleMinQty: 6,
          wholesaleMinQty: 24,
          taxRate: 20,
          unit: "bouteille",
          barcode: "6111234567890",
          brandName: "Sidi Ali",
          description: "Pack ; promo",
          minimumStock: 12,
          productStatus: "INACTIVE",
          targetStock: -3,
        },
        name,
      );
      assert.equal(lines[0].photoPath, "photos/REF_001.png");
    }
  });

  it("only the selected columns are written; absent columns and empty cells are never sent", () => {
    const columns = orderedProductColumns(["salePriceTTC"]);
    assert.deepEqual(columns.map((column) => column.header), ["ref_produit", "prixGros"], "the reference is always exported");
    const parsed = parseProductTable(["ref_produit", "prixGros", "designation"], rowsOf([["P1", "", ""]]));
    assert.deepEqual(parsed.lines[0].line, { excelRow: 2, reference: "P1" });
  });

  it("refuses a file without ref_produit; reports bad cells, protected photo URLs and bad paths", () => {
    assert.match(parseProductTable(["designation"], rowsOf([["x"]])).fatal!, /ref_produit/);
    const parsed = parseProductTable(
      ["ref_produit", "prixGros", "taux_tva", "statut", "photo"],
      rowsOf([
        ["P1", "abc", "150", "peut-être", "https://x.vercel.app/api/products/1/image"],
        ["P2", "1", "20", "Actif", "../../etc/passwd"],
        ["P3", "1", "20", "Arrêté", "https://cdn.example.com/p3.jpg"],
      ]),
    );
    assert.equal(parsed.lines[0].errors.length, 4);
    assert.match(parsed.lines[1].errors.join(), /chemin d'image invalide/);
    assert.deepEqual([parsed.lines[2].line.imageUrl, parsed.lines[2].line.productStatus], ["https://cdn.example.com/p3.jpg", "DISCONTINUED"]);
  });
});

describe("accounts format", () => {
  it("a HISTORICAL file (N_compte, Nom_Compte, Type_Compte, Tel) is read as before", () => {
    const parsed = parseAccountTable(["N_compte", "Nom_Compte", "Type_Compte", "Tel"], rowsOf([["2", "Yassine", "Clients", "0600000000"], ["F1", "Atlas", "Fournisseur", ""], ["X", "Prod", "Produit", ""]]));
    assert.deepEqual(parsed.lines[0].line, { excelRow: 2, code: "2", type: "CUSTOMER", name: "Yassine", phone: "0600000000" });
    assert.deepEqual(parsed.lines[1].line, { excelRow: 3, code: "F1", type: "SUPPLIER", name: "Atlas" }, "an empty Tel is NOT sent (never erases)");
    assert.match(parsed.lines[2].errors.join(), /non reconnu/);
  });

  it("all five types, GPS, treasury nature, employee fields; columns of another type are ignored with a warning", () => {
    const headers = ["N_compte", "Nom_Compte", "Type_Compte", "Latitude", "Longitude", "Nature_Tresorerie", "Compte_Avance", "Compte_Salaire", "Date_Embauche", "Salaire", "Statut"];
    const parsed = parseAccountTable(
      headers,
      rowsOf([
        ["C1", "Client", "Client", "33,5731234", "-7,5898341", "", "", "", "", "", "Bloqué"],
        ["5141", "Banque", "Trésorerie", "", "", "Banque", "", "", "", "", ""],
        ["E1", "Ali", "Employé", "", "", "", "34311", "44321", "01/02/2024", "4500,50", "Actif"],
        ["F1", "Fournisseur", "Fournisseur", "33", "-7", "", "", "", "", "", "Bloqué"],
      ]),
    );
    assert.deepEqual([parsed.lines[0].line?.latitude, parsed.lines[0].line?.longitude, parsed.lines[0].line?.accountStatus], [33.5731234, -7.5898341, "BLOCKED"]);
    assert.equal(parsed.lines[1].line?.treasuryKind, "BANK");
    assert.deepEqual(
      [parsed.lines[2].line?.advanceAccountCode, parsed.lines[2].line?.salaryAccountCode, parsed.lines[2].line?.hireDate, parsed.lines[2].line?.salary],
      ["34311", "44321", "2024-02-01", 4500.5],
    );
    assert.match(parsed.lines[3].warnings.join(), /ignorées/);
    assert.match(parsed.lines[3].errors.join(), /Bloqué ne concerne que les clients/);
  });

  it("every exported column comes back identical through the parser, GPS to the 7th decimal", () => {
    const rows: AccountExportRow[] = [
      { type: "CUSTOMER", code: "0042", name: "Épicerie ; Atlas", phone: "0612345678", email: "a@b.ma", address: "Rue 1", city: "Casa", latitude: 33.5731234, longitude: -7.5898341, ice: "001", taxId: "IF1", contactName: "M. A", customerType: "CAFE", creditLimit: 1500.5, creditLimitEnabled: true, notes: "=pas une formule", status: "BLOCKED" },
      { type: "TREASURY", code: "5161", name: "Caisse", treasuryKind: "CASH", status: "ACTIVE" },
      { type: "EMPLOYEE", code: "E01", name: "Ali", phone: "0700", hireDate: "2024-02-01", salary: 4500.5, advanceAccountCode: "34311", salaryAccountCode: "44321", status: "INACTIVE" },
    ];
    const columns = orderedAccountColumns(ACCOUNT_COLUMNS.map((column) => column.key), true);
    const cells = rows.map((row) => accountExportCells(row, columns));
    for (const [bytes, name] of [
      [writeXlsx("Comptes", columns, cells), "c.xlsx"],
      [writeCsv(columns, cells), "c.csv"],
    ] as const) {
      const table = readTableFile(bytes, name, "Comptes");
      const parsed = parseAccountTable(table.headers, table.rows);
      assert.deepEqual(parsed.lines.map((line) => line.errors), [[], [], []], name);
      const customer = parsed.lines[0].line!;
      assert.deepEqual(
        [customer.code, customer.name, customer.phone, customer.latitude, customer.longitude, customer.customerType, customer.creditLimit, customer.creditLimitEnabled, customer.notes, customer.accountStatus],
        ["0042", "Épicerie ; Atlas", "0612345678", 33.5731234, -7.5898341, "CAFE", 1500.5, true, "=pas une formule", "BLOCKED"],
        name,
      );
      assert.equal(parsed.lines[1].line?.treasuryKind, "CASH");
      assert.deepEqual([parsed.lines[2].line?.salary, parsed.lines[2].line?.hireDate, parsed.lines[2].line?.accountStatus], [4500.5, "2024-02-01", "INACTIVE"]);
    }
  });

  it("GPS columns are left out entirely when GPS is not included", () => {
    assert.equal(orderedAccountColumns(["phone"], false).some((column) => column.gps), false);
    assert.equal(orderedAccountColumns([], true).filter((column) => column.gps).length, 2);
  });
});

describe("export runner (fake API) -> import reader", () => {
  const productRows: ProductExportRow[] = Array.from({ length: 3 }, (_, i) => ({
    reference: `REF-${i}`,
    name: `Produit ${i}`,
    categoryName: "Cat",
    supplierCode: "F1",
    supplierName: "Fourn",
    purchasePriceTTC: 1.2,
    salePriceTTC: 2.4,
    retailPriceTTC: null,
    semiWholesalePriceTTC: null,
    semiWholesaleMinQty: null,
    wholesaleMinQty: null,
    taxRate: 20,
    unit: "u",
    barcode: null,
    brandName: null,
    description: null,
    minimumStock: 0,
    status: "ACTIVE",
    depotStock: null,
    photo: i === 0 ? { kind: "stored" } : i === 1 ? { kind: "url", url: "https://cdn.example.com/1.png" } : null,
  }));
  const fakeProducts: FetchJson = async <T,>(url: string, init?: { method: "POST"; body: unknown }) => {
    if (url.startsWith("/api/produits/export?")) {
      const cursor = new URL(url, "http://x").searchParams.get("cursor");
      const start = cursor ? Number(cursor) : 0;
      return { rows: productRows.slice(start, start + 2), nextCursor: start + 2 < productRows.length ? String(start + 2) : null, total: start ? null : productRows.length, depotName: null } as T;
    }
    const references = (init!.body as { references: string[] }).references;
    return { photos: references.map((reference) => ({ reference, dataUrl: photoDataUrl(PNG, "image/png") })), remaining: [], skipped: [] } as T;
  };

  it("pages through the API, ZIP holds the data file + photos, re-read gives the same lines and photo bytes", async () => {
    const result = await runProductsExport({ columns: ["name", "salePriceTTC", "photo"], format: "zip", filters: {}, fetchJson: fakeProducts, now: new Date(2026, 0, 2, 3, 4) });
    assert.equal(result.fileName, "produits_2026-01-02_0304.zip");
    assert.equal(result.rowCount, 3);
    const content = readProductImportFile(result.bytes, result.fileName);
    assert.equal(content.dataFileName, "produits.xlsx");
    assert.deepEqual(content.parsed.lines.map((line) => line.line.reference), ["REF-0", "REF-1", "REF-2"]);
    assert.deepEqual(content.photos.get(2)?.bytes, PNG, "the stored photo of REF-0 travels in the archive");
    assert.equal(content.parsed.lines[1].line.imageUrl, "https://cdn.example.com/1.png", "an external URL stays an URL");
    assert.equal(content.photoIssues.size, 0);
  });

  it("warns about products without supplier (not creatable elsewhere) and photos in an unsupported format", async () => {
    const rows = productRows.map((row, i) => ({ ...row, supplierCode: i === 2 ? null : row.supplierCode }));
    const fake: FetchJson = async <T,>(url: string, init?: { method: "POST"; body: unknown }) => {
      if (url.startsWith("/api/produits/export?")) return { rows, nextCursor: null, total: rows.length, depotName: null } as T;
      const references = (init!.body as { references: string[] }).references;
      return { photos: references.map((reference) => ({ reference, dataUrl: `data:image/svg+xml;base64,${bytesToBase64(strToU8("<svg/>"))}` })), remaining: [], skipped: [] } as T;
    };
    const result = await runProductsExport({ columns: ["supplierCode", "photo"], format: "zip", filters: {}, fetchJson: fake });
    assert.match(result.warnings.join("\n"), /1 produit\(s\) sans fournisseur/);
    assert.match(result.warnings.join("\n"), /Photo de REF-0 illisible ou dans un format non pris en charge/);
    const content = readProductImportFile(result.bytes, result.fileName);
    assert.equal(content.photos.size, 0, "an SVG never travels in the archive");
    const noSupplierColumn = await runProductsExport({ columns: ["name"], format: "csv", filters: {}, fetchJson: fake });
    assert.doesNotMatch(noSupplierColumn.warnings.join(), /sans fournisseur/, "only when the supplier column is exported");
  });

  it("outside a ZIP, stored photos are left out with a warning", async () => {
    const result = await runProductsExport({ columns: ["photo"], format: "csv", filters: {}, fetchJson: fakeProducts });
    assert.match(result.warnings.join(), /format ZIP/);
    const content = readProductImportFile(result.bytes, result.fileName);
    assert.equal(content.parsed.lines[0].photoPath, undefined);
  });

  it("accounts: every requested type, one file", async () => {
    const fake: FetchJson = async <T,>(url: string) => {
      const type = new URL(url, "http://x").searchParams.get("type");
      return { rows: [{ type, code: `${type}-1`, name: String(type) }], nextCursor: null } as T;
    };
    const result = await runAccountsExport({ types: ["CUSTOMER", "TREASURY", "EMPLOYEE"], columns: [], includeGps: true, format: "xlsx", fetchJson: fake });
    const table = readTableFile(result.bytes, result.fileName, "Comptes");
    assert.deepEqual(table.headers, ["N_compte", "Nom_Compte", "Type_Compte", "Latitude", "Longitude"]);
    assert.deepEqual(table.rows.map((row) => row.cells[2]), ["Client", "Trésorerie", "Employé"]);
  });
});

describe("import file reader (ZIP problems)", () => {
  const data = (photo: string) => writeCsv([{ header: "ref_produit", kind: "text" }, { header: "photo", kind: "text" }], [["A", photo], ["B", "photos/missing.png"], ["C", "photos/fake.png"], ["D", "photos/a.png"]]);

  it("missing, unreadable, duplicated and too-large images are reported per line; other data is kept", () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 10);
    big.set(PNG);
    const zip = buildArchive([
      { path: "produits.csv", data: data("photos/a.png") },
      { path: "photos/a.png", data: PNG },
      { path: "photos/fake.png", data: strToU8("not an image at all") },
      { path: "photos/big.png", data: big },
      { path: "photos/unused.png", data: PNG },
    ]);
    const content = readProductImportFile(zip, "export.zip");
    assert.deepEqual(content.parsed.lines.map((line) => line.errors), [[], [], [], []]);
    assert.ok(content.photos.has(2));
    assert.match(content.photoIssues.get(3)!, /introuvable/);
    assert.match(content.photoIssues.get(4)!, /Format d'image non pris en charge/);
    assert.match(content.photoIssues.get(5)!, /déjà utilisée par la ligne 2/);
    assert.equal(content.archive?.unusedImages, 2, "big.png is too large and unused.png is not referenced");
    const bigOnly = readProductImportFile(buildArchive([{ path: "produits.csv", data: data("photos/big.png") }, { path: "photos/big.png", data: big }]), "x.zip");
    assert.match(bigOnly.photoIssues.get(2)!, /trop volumineuse/);
  });

  it("an archive without a data file, or with several, is refused clearly; a photo path in a plain file is ignored with a message", () => {
    assert.throws(() => readProductImportFile(buildArchive([{ path: "photos/a.png", data: PNG }]), "x.zip"), /fichier de données introuvable/);
    assert.throws(
      () => readProductImportFile(buildArchive([{ path: "a.csv", data: data("x") }, { path: "b.csv", data: data("x") }]), "x.zip"),
      /plusieurs fichiers de données/,
    );
    const plain = readProductImportFile(data("photos/a.png"), "p.csv");
    assert.match(plain.photoIssues.get(2)!, /archive ZIP/);
  });
});
