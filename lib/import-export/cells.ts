import { unguardText } from "@/lib/import-export/csv";

/**
 * Reading the cells of an imported file (Excel or CSV) - pure, shared by the
 * products and accounts imports.
 *
 * RULE OF THE IMPORTS: a column absent from the file and a cell left empty both
 * mean "do not change this field" - every reader below returns `undefined` for
 * them, never an empty value to write.
 */

/** Case, accent, space, "_" and "-" tolerant header key: "N° compte" ~ "n_compte" -> "ncompte". */
export function headerKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/°/g, "")
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "");
}

/** Index of the first header matching one of `names` (compared with headerKey), -1 when absent. */
export function findColumn(headers: readonly unknown[], names: readonly string[]): number {
  const wanted = new Set(names.map(headerKey));
  return headers.findIndex((header) => wanted.has(headerKey(header)));
}

export function isBlankCell(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === "";
}

/** Trimmed text, or undefined for an empty cell. A spreadsheet number keeps its digits ("612345678"). */
export function readText(value: unknown): string | undefined {
  if (isBlankCell(value)) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  return unguardText(String(value).trim());
}

export type BarcodeCell = {
  /** The barcode as exact text (undefined for an empty cell or a refused one). */
  value?: string;
  /** The cell cannot be trusted: the line is refused with this message. */
  error?: string;
  /** Suspicious but possible: shown, never blocking. */
  warning?: string;
};

/** What a spreadsheet writes when it turns a long number into "2,10E+12" (an "E" followed by a sign, or a decimal part). */
const SCIENTIFIC_NOTATION = /^[+-]?\d+(?:[.,]\d+)?e[+-]\d+$|^[+-]?\d+[.,]\d+e[+-]?\d+$/i;

/** Digits above which Excel keeps no precision: a number cell of 16 digits or more has already been rounded. */
const EXCEL_EXACT_LIMIT = 1e15;

/**
 * A barcode cell, kept EXACT (it is an identifier, never a number):
 *   - text stays text, leading zeros included ("0012345678905");
 *   - a numeric Excel cell keeps all its digits when Excel kept them; with 16
 *     digits or more, or decimals, Excel has rounded it -> refused (type the
 *     barcode as text);
 *   - a text already written in scientific notation ("2,10E+12") -> refused;
 *   - a numeric cell of 12 or 7 digits may have lost a leading zero (EAN-13 /
 *     EAN-8): a warning, not an error (a genuine UPC-A has 12 digits).
 */
export function readBarcode(value: unknown): BarcodeCell {
  if (isBlankCell(value)) return {};
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value >= EXCEL_EXACT_LIMIT) {
      return { error: "Code-barres numérique illisible ou arrondi par le tableur (15 chiffres conservés au plus) : saisissez-le en texte." };
    }
    const digits = String(value);
    return digits.length === 12 || digits.length === 7
      ? { value: digits, warning: `Code-barres numérique de ${digits.length} chiffres : un zéro initial a peut-être été perdu par le tableur, vérifiez-le.` }
      : { value: digits };
  }
  const text = unguardText(String(value).trim());
  if (SCIENTIFIC_NOTATION.test(text)) {
    return { error: `Code-barres « ${text} » en notation scientifique : le tableur l'a converti, saisissez-le en texte.` };
  }
  return { value: text };
}

/**
 * A decimal number written with a comma OR a point ("33,5731" / "33.5731"),
 * thousands separated by spaces, or "1 234,56" / "1.234,56". When both "," and
 * "." appear, the LAST one is the decimal separator. A single kind of separator
 * is always the decimal one (never read as thousands): "33.5731" is 33.5731.
 * undefined = empty cell; null = present but not a number.
 */
export function readDecimal(value: unknown): number | null | undefined {
  if (isBlankCell(value)) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value).trim().replace(/[\s  ']/g, "");
  if (text.endsWith("%")) text = text.slice(0, -1);
  const lastComma = text.lastIndexOf(",");
  const lastPoint = text.lastIndexOf(".");
  if (lastComma >= 0 && lastPoint >= 0) {
    const decimal = lastComma > lastPoint ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    text = text.split(thousands).join("");
    if (decimal === ",") text = text.replace(",", ".");
  } else if (lastComma >= 0) {
    if (text.indexOf(",") !== lastComma) return null; // "1,2,3" is not a number
    text = text.replace(",", ".");
  } else if (lastPoint >= 0 && text.indexOf(".") !== lastPoint) {
    return null; // "1.2.3"
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(text) && !/^[-+]?\.\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A whole number (decimals refused). undefined = empty; null = invalid. */
export function readInteger(value: unknown): number | null | undefined {
  const parsed = readDecimal(value);
  if (parsed === undefined || parsed === null) return parsed;
  return Number.isInteger(parsed) ? parsed : null;
}

/** "oui"/"non", "true"/"false", "1"/"0", "actif"... undefined = empty; null = unreadable. */
export function readBoolean(value: unknown): boolean | null | undefined {
  if (isBlankCell(value)) return undefined;
  if (typeof value === "boolean") return value;
  const key = headerKey(value);
  if (["oui", "o", "yes", "y", "true", "vrai", "1", "x"].includes(key)) return true;
  if (["non", "n", "no", "false", "faux", "0"].includes(key)) return false;
  return null;
}

/** "YYYY-MM-DD", "DD/MM/YYYY" or an Excel serial date -> "YYYY-MM-DD". undefined = empty; null = invalid. */
export function readDate(value: unknown): string | null | undefined {
  if (isBlankCell(value)) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) => {
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d && y >= 1900 && y <= 2200;
  };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    // Excel serial date (1900 system): day 25569 = 1970-01-01.
    const date = new Date(Math.round((value - 25569) * 86_400_000));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  const text = String(value).trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    const [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  return null;
}

/** Number of decimals stored for a coordinate (Customer.latitude / longitude are Decimal(10, 7)). */
export const COORDINATE_DECIMALS = 7;

export type CoordinateCells =
  | { kind: "absent" }
  | { kind: "value"; latitude: number; longitude: number }
  | { kind: "error"; message: string };

const roundCoordinate = (value: number) => Math.round(value * 10 ** COORDINATE_DECIMALS) / 10 ** COORDINATE_DECIMALS;

/**
 * The two GPS cells of a line, ALWAYS read from their own named columns
 * (Latitude / Longitude - never by position, so they can never be swapped):
 *   - both empty (or the columns absent)  -> absent: the stored coordinates are kept
 *   - only one filled                     -> error (a lone half would be meaningless)
 *   - latitude outside [-90, 90] or longitude outside [-180, 180] -> error
 *   - otherwise both values, rounded to 7 decimals like the database column.
 */
export function readCoordinates(latitudeCell: unknown, longitudeCell: unknown): CoordinateCells {
  const latitude = readDecimal(latitudeCell);
  const longitude = readDecimal(longitudeCell);
  if (latitude === undefined && longitude === undefined) return { kind: "absent" };
  if (latitude === undefined || longitude === undefined) {
    return { kind: "error", message: "Latitude et Longitude doivent être renseignées ensemble." };
  }
  if (latitude === null) return { kind: "error", message: "Latitude invalide (nombre attendu)." };
  if (longitude === null) return { kind: "error", message: "Longitude invalide (nombre attendu)." };
  if (latitude < -90 || latitude > 90) return { kind: "error", message: `Latitude hors limites (${latitude}) : doit être entre -90 et 90.` };
  if (longitude < -180 || longitude > 180) {
    return { kind: "error", message: `Longitude hors limites (${longitude}) : doit être entre -180 et 180.` };
  }
  return { kind: "value", latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

/** A number written for a file: comma decimal (French spreadsheet), no thousands separator, no trailing zeros noise. */
export function formatDecimalForCsv(value: number, maxDecimals = 7): string {
  const fixed = value.toFixed(maxDecimals).replace(/\.?0+$/, "");
  return (fixed === "-0" ? "0" : fixed).replace(".", ",");
}
