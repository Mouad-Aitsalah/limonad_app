import * as XLSX from "xlsx";

import { formatDecimalForCsv } from "@/lib/import-export/cells";
import { guardText, parseCsv, toCsv } from "@/lib/import-export/csv";

/**
 * Reading / writing the table of an export or import file, Excel (.xlsx, .xls)
 * or CSV - isomorphic (browser and tests).
 *
 * Reading keeps cells RAW (no type guessing on CSV: "007" stays "007"); an
 * Excel workbook is read on the named sheet ("produits" / "Comptes", the
 * historical names, matched case-insensitively), else - for a workbook with a
 * single sheet - on that sheet.
 *
 * Writing: text cells are written as TEXT (an Excel cell "0612..." keeps its
 * leading zero, a code is never turned into a number), numbers as numbers.
 */

export type CellValue = string | number | null | undefined;
export type ColumnKind = "text" | "number";
export type TableColumn = { header: string; kind: ColumnKind };

/** A data row with its line number in the file (Excel line; for a CSV, the record number + 1). */
export type TableRow = { line: number; cells: unknown[] };
export type ReadTable = { headers: unknown[]; rows: TableRow[] };

export class TableFileError extends Error {}

export function fileKind(fileName: string): "xlsx" | "csv" | "zip" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

function decodeText(bytes: Uint8Array): string {
  // Excel's "Texte Unicode" is UTF-16 with a byte order mark (little endian; big endian on some tools).
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // A file saved in Windows-1252 by an old spreadsheet shows U+FFFD: decode it as such.
  if (utf8.includes("�")) {
    try {
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/**
 * Every row of the file as it is (the first one included, no header assumed): a
 * CSV is decoded (UTF-8 with or without BOM, UTF-16 with BOM, else Windows-1252)
 * and split without type guessing; an Excel workbook is read on the named sheet.
 * Throws TableFileError with a readable message. readTableFile below assumes the
 * first row is the header; a reader that must recognise a file WITHOUT header
 * (the products import with variants) starts from this grid.
 */
export function readTableGrid(bytes: Uint8Array, fileName: string, sheetName: string): unknown[][] {
  const kind = fileKind(fileName);
  let grid: unknown[][];
  if (kind === "csv") {
    grid = parseCsv(decodeText(bytes));
  } else if (kind === "xlsx") {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(bytes, { type: "array", raw: true });
    } catch {
      throw new TableFileError("Fichier Excel illisible.");
    }
    const name =
      workbook.SheetNames.find((candidate) => candidate === sheetName) ??
      workbook.SheetNames.find((candidate) => candidate.trim().toLowerCase() === sheetName.toLowerCase()) ??
      (workbook.SheetNames.length === 1 ? workbook.SheetNames[0] : undefined);
    if (!name) throw new TableFileError(`Feuille « ${sheetName} » introuvable dans le fichier.`);
    grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, blankrows: true, defval: null });
  } else {
    throw new TableFileError("Format de fichier non pris en charge (.xlsx, .xls, .csv ou .zip attendu).");
  }
  return grid;
}

/** The data rows of a grid below its header row, each with its line number (header = line 1), entirely empty rows dropped. */
export function tableFromGrid(grid: readonly unknown[][]): ReadTable {
  const [headers = [], ...rows] = grid;
  // Keep the real line number, then drop rows that are entirely empty (formatting left in a spreadsheet).
  return {
    headers,
    rows: rows
      .map((cells, index) => ({ line: index + 2, cells }))
      .filter((row) => row.cells.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")),
  };
}

/** The header row and the data rows of a file; throws TableFileError with a readable message. */
export function readTableFile(bytes: Uint8Array, fileName: string, sheetName: string): ReadTable {
  return tableFromGrid(readTableGrid(bytes, fileName, sheetName));
}

/** An .xlsx workbook with one sheet. */
export function writeXlsx(sheetName: string, columns: readonly TableColumn[], rows: ReadonlyArray<ReadonlyArray<CellValue>>): Uint8Array {
  const sheet: XLSX.WorkSheet = {};
  const put = (r: number, c: number, cell: XLSX.CellObject) => {
    sheet[XLSX.utils.encode_cell({ r, c })] = cell;
  };
  columns.forEach((column, c) => put(0, c, { t: "s", v: column.header }));
  rows.forEach((row, r) => {
    columns.forEach((column, c) => {
      const value = row[c];
      if (value === null || value === undefined || value === "") return;
      if (column.kind === "number" && typeof value === "number" && Number.isFinite(value)) put(r + 1, c, { t: "n", v: value });
      else put(r + 1, c, { t: "s", v: String(value) });
    });
  });
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: Math.max(columns.length - 1, 0) } });
  sheet["!cols"] = columns.map((column) => ({ wch: Math.min(40, Math.max(10, column.header.length + 2)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(out);
}

/** A CSV file (UTF-8 BOM, ";"), numbers with a decimal comma, text guarded against formulas. */
export function writeCsv(columns: readonly TableColumn[], rows: ReadonlyArray<ReadonlyArray<CellValue>>): Uint8Array {
  const lines = [
    columns.map((column) => column.header),
    ...rows.map((row) =>
      columns.map((column, c) => {
        const value = row[c];
        if (value === null || value === undefined) return "";
        if (column.kind === "number" && typeof value === "number") return formatDecimalForCsv(value);
        return guardText(String(value));
      }),
    ),
  ];
  return new TextEncoder().encode(toCsv(lines));
}
