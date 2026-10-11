import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";

/**
 * The OPTIONAL columns of the products Excel import (feuille "produits"):
 * quantity pricing tiers and the unit. Isomorphic and pure (the browser parses
 * the file with it, the server re-checks with it, the tests cover it).
 *
 *   Excel header                     -> field (Product)
 *   prix_detail       (TTC)          -> retailPrice (stored HT)
 *   prix_semi_gros    (TTC)          -> semiWholesalePrice (stored HT)
 *   Qped              (whole qty)    -> semiWholesaleMinQty
 *   Qgros             (whole qty)    -> wholesaleMinQty
 *   unite                            -> unit (the existing field)
 * and `prix_gros` is accepted as another spelling of the existing required
 * `prixGros` column (same field, Product.salePrice - never a second price).
 *
 * Old files (none of these columns) work exactly as before. A column that is
 * absent, or a cell left empty, NEVER changes the stored value: the field is
 * simply not sent. Prices are TTC like prixAchatTTC / prixGros and converted to
 * HT with the line's VAT, like them.
 */

export type OptionalImportField =
  | "retailPriceTTC"
  | "semiWholesalePriceTTC"
  | "semiWholesaleMinQty"
  | "wholesaleMinQty"
  | "unit";

/** The optional values of one file line; a missing key = "keep what is stored". */
export type OptionalImportValues = Partial<{
  retailPriceTTC: number;
  semiWholesalePriceTTC: number;
  semiWholesaleMinQty: number;
  wholesaleMinQty: number;
  unit: string;
}>;

/** Header as written in the messages and the instructions. */
export const OPTIONAL_IMPORT_HEADERS: Record<OptionalImportField, string> = {
  retailPriceTTC: "prix_detail",
  semiWholesalePriceTTC: "prix_semi_gros",
  semiWholesaleMinQty: "Qped",
  wholesaleMinQty: "Qgros",
  unit: "unite",
};

/** Largest accepted threshold (a sanity bound, like the POS quantity). */
export const IMPORT_TIER_THRESHOLD_MAX = 1_000_000;
/** Product.unit is free text; a value longer than this is refused. */
export const IMPORT_UNIT_MAX_LENGTH = 40;

/** Case, accent, space, "_" and "-" tolerant: "Prix détail", "PRIX_DETAIL", "prixDetail" match. */
export function looseHeaderKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

const OPTIONAL_HEADER_KEYS: Record<string, OptionalImportField> = {
  prixdetail: "retailPriceTTC",
  prixdetailttc: "retailPriceTTC",
  prixsemigros: "semiWholesalePriceTTC",
  prixsemigrosttc: "semiWholesalePriceTTC",
  qped: "semiWholesaleMinQty",
  qgros: "wholesaleMinQty",
  unite: "unit",
};

/** Column index of each optional field present in the header row (absent = not in the map). */
export function findOptionalImportColumns(headerRow: readonly unknown[]): Partial<Record<OptionalImportField, number>> {
  const columns: Partial<Record<OptionalImportField, number>> = {};
  headerRow.forEach((header, index) => {
    const field = OPTIONAL_HEADER_KEYS[looseHeaderKey(header)];
    if (field && columns[field] === undefined) columns[field] = index;
  });
  return columns;
}

/**
 * Index of a REQUIRED header (already normalised by the page: trim + lowercase +
 * no spaces), also accepting its other spelling: `prix_gros` for `prixgros`.
 */
const REQUIRED_HEADER_SYNONYMS: Record<string, readonly string[]> = {
  prixgros: ["prix_gros"],
};

export function findRequiredImportHeader(normalizedHeaders: readonly string[], header: string): number {
  const direct = normalizedHeaders.indexOf(header);
  if (direct >= 0) return direct;
  for (const synonym of REQUIRED_HEADER_SYNONYMS[header] ?? []) {
    const index = normalizedHeaders.indexOf(synonym);
    if (index >= 0) return index;
  }
  return -1;
}

function isBlank(value: unknown): boolean {
  return value == null || String(value).trim() === "";
}

function parseDecimal(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Qped < Qgros when both are known - otherwise the rule would be ambiguous.
 * Used on the file line (both columns filled) and, on the server, on the value
 * the product will really have (file value, else the stored one).
 */
export function tierThresholdsError(
  semiWholesaleMinQty: number | null | undefined,
  wholesaleMinQty: number | null | undefined,
): string | null {
  if (semiWholesaleMinQty == null || wholesaleMinQty == null) return null;
  return semiWholesaleMinQty < wholesaleMinQty
    ? null
    : `Qped (${semiWholesaleMinQty}) doit être inférieur à Qgros (${wholesaleMinQty})`;
}

/**
 * The optional cells of one line -> the values to send + the line's errors.
 * Empty cell / absent column = not sent. Any value present must be valid:
 * prices numeric and >= 0, thresholds whole numbers >= 1, Qped < Qgros.
 */
export function parseOptionalImportCells(
  cell: (field: OptionalImportField) => unknown,
  columns: Partial<Record<OptionalImportField, number>>,
): { values: OptionalImportValues; errors: string[] } {
  const values: OptionalImportValues = {};
  const errors: string[] = [];
  const raw = (field: OptionalImportField) => (columns[field] === undefined ? undefined : cell(field));

  for (const field of ["retailPriceTTC", "semiWholesalePriceTTC"] as const) {
    const value = raw(field);
    if (isBlank(value)) continue;
    const parsed = parseDecimal(value);
    if (parsed == null || parsed < 0 || parsed > MONEY_RANGE_MAX_NUMBER) {
      errors.push(`${OPTIONAL_IMPORT_HEADERS[field]} invalide (nombre positif ou nul attendu)`);
    } else {
      values[field] = parsed;
    }
  }

  for (const field of ["semiWholesaleMinQty", "wholesaleMinQty"] as const) {
    const value = raw(field);
    if (isBlank(value)) continue;
    const parsed = parseDecimal(value);
    if (parsed == null || !Number.isInteger(parsed) || parsed < 1 || parsed > IMPORT_TIER_THRESHOLD_MAX) {
      errors.push(`${OPTIONAL_IMPORT_HEADERS[field]} invalide (quantité entière ≥ 1 attendue)`);
    } else {
      values[field] = parsed;
    }
  }

  const thresholds = tierThresholdsError(values.semiWholesaleMinQty, values.wholesaleMinQty);
  if (thresholds) errors.push(thresholds);

  const unit = raw("unit");
  if (!isBlank(unit)) {
    const text = String(unit).trim();
    if (text.length > IMPORT_UNIT_MAX_LENGTH) {
      errors.push(`unite trop longue (${IMPORT_UNIT_MAX_LENGTH} caractères maximum)`);
    } else {
      values.unit = text;
    }
  }

  return { values, errors };
}
