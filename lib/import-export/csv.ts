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
 * detected on the first lines (";" "," or tab, see detectSeparator), so a CSV
 * saved by another tool - with or without a header line - is read too.
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

const CANDIDATE_SEPARATORS = [";", ",", "\t"] as const;
/** Lines looked at to recognise the separator (a header line alone can mislead, and some files have none). */
const SEPARATOR_DETECTION_LINES = 20;

/**
 * Number of fields of each of the first lines if `separator` were the separator,
 * with the SAME quote rules as parseCsv: a quote opens a quoted field only at
 * the start of a field ("3/4\"" in the middle of a value is a plain character),
 * and "" inside quotes is an escaped quote.
 */
function fieldCountsPerLine(text: string, separator: string): number[] {
  const counts: number[] = [];
  let inQuotes = false;
  let fieldQuoted = false;
  let fieldEmpty = true;
  let fields = 1;
  let hasContent = false;
  for (let i = 0; i < text.length && counts.length < SEPARATOR_DETECTION_LINES; i += 1) {
    const char = text[i];
    const lineHadContent = hasContent;
    hasContent = true;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
    } else if (char === '"' && fieldEmpty && !fieldQuoted) {
      inQuotes = true;
      fieldQuoted = true;
    } else if (char === separator) {
      fields += 1;
      fieldEmpty = true;
      fieldQuoted = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      if (lineHadContent) counts.push(fields);
      fields = 1;
      fieldEmpty = true;
      fieldQuoted = false;
      hasContent = false;
    } else {
      fieldEmpty = false;
    }
  }
  if (hasContent && counts.length < SEPARATOR_DETECTION_LINES) counts.push(fields);
  return counts;
}

/** The historical rule: the first separator found on the first line (";" else "," else tab); null when the line holds none. */
function firstLineSeparator(text: string): string | null {
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
  return null;
}

/** Another candidate that cuts EVERY analysed line into the same number of fields, more than `moreThan` (the real separator, not a stray one). */
function cutsEveryLineIntoMoreFields(text: string, legacy: string, moreThan: number): boolean {
  return CANDIDATE_SEPARATORS.some((separator) => {
    if (separator === legacy) return false;
    const counts = fieldCountsPerLine(text, separator);
    return counts.length > 1 && counts[0] > moreThan && counts.every((count) => count === counts[0]);
  });
}

/**
 * The separator of a CSV text.
 *
 * COMPATIBILITY FIRST - the historical rule (the separator of the first line,
 * ";" when it has none) is kept whenever it is plausible:
 *   - the first line holds no separator at all: a one-column file, read as one
 *     column whatever its values contain (an unquoted "4,80" is not a separator);
 *   - it cuts every one of the first lines into the same number of fields;
 *   - it cuts MORE THAN HALF of the first lines into several fields (ragged
 *     lines, e.g. a tool that dropped trailing empty cells, must not hand the
 *     file over to the decimal commas of its values) - unless another
 *     separator cuts every line into the same, larger number of fields.
 * Only otherwise - typically a header-less file whose first line holds a stray
 * ";" while the other lines do not - is the separator chosen among ";", "," and
 * tab as the one that cuts the first lines into the SAME number of fields most
 * often; on a tie the more fields win, then the order ";" "," tab.
 */
export function detectSeparator(text: string): string {
  const found = firstLineSeparator(text);
  const legacy = found ?? ";";
  if (found === null) return legacy;
  const legacyCounts = fieldCountsPerLine(text, legacy);
  if (legacyCounts.length > 0 && legacyCounts[0] > 1) {
    if (legacyCounts.every((count) => count === legacyCounts[0])) return legacy;
    const severalFields = legacyCounts.filter((count) => count > 1).length;
    if (severalFields * 2 > legacyCounts.length && !cutsEveryLineIntoMoreFields(text, legacy, Math.max(...legacyCounts))) return legacy;
  }

  let best: { separator: string; lines: number; fields: number } | null = null;
  for (const separator of CANDIDATE_SEPARATORS) {
    const counts = fieldCountsPerLine(text, separator);
    const frequency = new Map<number, number>();
    for (const count of counts) if (count > 1) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    let fields = 0;
    let lines = 0;
    for (const [count, seen] of frequency) {
      if (seen > lines || (seen === lines && count > fields)) {
        fields = count;
        lines = seen;
      }
    }
    if (!lines) continue;
    if (!best || lines > best.lines || (lines === best.lines && fields > best.fields)) best = { separator, lines, fields };
  }
  return best?.separator ?? legacy;
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
