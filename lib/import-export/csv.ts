/**
 * CSV of the COMDIS exports / imports - pure and isomorphic.
 *
 * Written as UTF-8 with a BOM (Excel then reads the accents correctly),
 * separator ";" (what a French Excel expects), CRLF line ends, RFC 4180
 * quoting: a field containing ";", a quote, a line break or edge spaces is
 * wrapped in quotes and its quotes doubled.
 *
 * Read with a real state machine - never a naive split(";"): quoted fields may
 * contain the separator, doubled quotes and line breaks. The separator is
 * detected on the header line (";" else "," else tab), so a CSV saved by
 * another tool is read too.
 *
 * Formula guard: a TEXT value starting with = + - @ (or a tab / CR) could be run
 * as a formula when the CSV is opened in a spreadsheet. On export such a value
 * is prefixed with an apostrophe; on import a single apostrophe in front of one
 * of those characters is removed again (unguardText) - so the round trip gives
 * back exactly the original text. Numbers are never guarded.
 */

export const CSV_SEPARATOR = ";";
export const CSV_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;

/** Text cell value made safe to open in a spreadsheet (see the header). */
export function guardText(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Undoes guardText: "'=x" -> "=x"; any other text is returned as is. */
export function unguardText(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

function quoteField(field: string): string {
  return /[";\r\n]/.test(field) || field !== field.trim() ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Rows of already formatted cells -> the CSV text (BOM included). */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return CSV_BOM + rows.map((row) => row.map(quoteField).join(CSV_SEPARATOR)).join("\r\n") + "\r\n";
}

function detectSeparator(text: string): string {
  let inQuotes = false;
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === "\n" || char === "\r")) break;
    else if (!inQuotes && char in counts) counts[char] += 1;
  }
  if (counts[";"] > 0) return ";";
  if (counts[","] > 0) return ",";
  if (counts["\t"] > 0) return "\t";
  return ";";
}

/**
 * CSV text -> rows of strings (no type guessing: "007" stays "007"). Fully
 * empty lines are skipped. A quote that never closes keeps the rest of the text
 * in the field (nothing is silently dropped).
 */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(CSV_BOM) ? input.slice(1) : input;
  const separator = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldQuoted = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldQuoted = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "" && !fieldQuoted) {
      inQuotes = true;
      fieldQuoted = true;
    } else if (char === separator) {
      endField();
    } else if (char === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      field += char;
    }
  }
  if (field !== "" || fieldQuoted || row.length > 0) endRow();
  return rows;
}
