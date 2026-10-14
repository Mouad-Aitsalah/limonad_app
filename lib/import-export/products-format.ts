import { findColumn, headerKey, isBlankCell, readBarcode, readDecimal, readInteger, readText } from "@/lib/import-export/cells";
import { isPortablePhotoUrl } from "@/lib/import-export/images";
import { tableFromGrid, type CellValue, type TableColumn, type TableRow } from "@/lib/import-export/tabular";
import { safeArchivePath } from "@/lib/import-export/zip";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { IMPORT_TIER_THRESHOLD_MAX, IMPORT_UNIT_MAX_LENGTH, tierThresholdsError } from "@/lib/products-import-pricing";
import {
  VARIANT_LIMITS,
  canonicalizeVariantGroups,
  deriveSimpleReference,
  deriveVariantReference,
  parseVariantAttributes,
  variantDisplayName,
  variantFileGroupKey,
  type ReferenceSource,
  type VariantAttribute,
} from "@/lib/products-import-variants";

/**
 * THE file format of the products export / import (feuille "produits", or the
 * same columns in a CSV, or produits.xlsx|csv + photos/ in a ZIP) - pure.
 *
 * The historical headers are kept EXACTLY (ref_produit, ref_fournisseur,
 * designation, type, prixAchatTTC, prixGros, taux_tva, QuantiteStock,
 * prix_detail, prix_semi_gros, Qped, Qgros, unite): every file the import has
 * ever accepted is still accepted, and an exported file is read by the same
 * code. New columns are optional.
 *
 * Only `ref_produit` is required in a file: it identifies the product in the
 * DESTINATION organisation (never an internal id). Every other column is
 * optional - absent or empty = the stored value is kept. Creating a product
 * still needs its creation fields (checked by the server, which knows whether
 * the reference exists): designation, type, ref_fournisseur, prixAchatTTC,
 * prixGros, taux_tva.
 *
 * Prices are TTC, as the import has always read them (the database keeps HT:
 * HT -> TTC -> HT gives back the same cents, checked on 1 000 000 cases).
 * QuantiteStock is the depot stock TARGET of the importer's own depot - never
 * exported by default, and only applied when the user explicitly confirms it.
 */

export type ProductStatusCode = "ACTIVE" | "INACTIVE" | "DISCONTINUED";

export const PRODUCT_STATUS_LABELS: Record<ProductStatusCode, string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  DISCONTINUED: "Arrêté",
};

/** One line of the import as sent to the server: a missing key = "keep what is stored". */
export type ProductImportLine = {
  excelRow: number;
  reference: string;
  name?: string;
  categoryName?: string;
  supplierCode?: string;
  /** Name given to the supplier when the import creates it (else its code is its name). */
  supplierName?: string;
  purchasePriceTTC?: number;
  salePriceTTC?: number;
  retailPriceTTC?: number;
  semiWholesalePriceTTC?: number;
  semiWholesaleMinQty?: number;
  wholesaleMinQty?: number;
  taxRate?: number;
  unit?: string;
  barcode?: string;
  brandName?: string;
  description?: string;
  minimumStock?: number;
  productStatus?: ProductStatusCode;
  /** Depot stock target - applied only when the import is confirmed with "apply stock". */
  targetStock?: number;
  /** An external http(s) photo URL (a photo inside a ZIP is sent separately, after the lines). */
  imageUrl?: string;
  /**
   * Variants format only (never set on a historical file): how the reference was
   * obtained when the file gives none - "barcode" (the barcode itself) or
   * "generated" (deterministic, see lib/products-import-variants.ts).
   */
  referenceSource?: ReferenceSource;
  /** Variants format: the parent product as written (one spelling per file group). */
  variantParentName?: string;
  /** Variants format: the attributes, ordered and structured - present only when the cell was read without error. */
  variantAttributes?: VariantAttribute[];
  /** Variants format: the raw variant cell, kept only when it could not be read (to show it and block the product). */
  variantRaw?: string;
  /** Variants format, set when the lines are sent for writing: how many lines of the file belong to this group (unreadable ones included). */
  variantGroupSize?: number;
};

export type ProductColumnKey =
  | "reference"
  | "name"
  | "categoryName"
  | "supplierCode"
  | "supplierName"
  | "purchasePriceTTC"
  | "salePriceTTC"
  | "retailPriceTTC"
  | "semiWholesalePriceTTC"
  | "semiWholesaleMinQty"
  | "wholesaleMinQty"
  | "taxRate"
  | "unit"
  | "barcode"
  | "brandName"
  | "description"
  | "minimumStock"
  | "status"
  | "targetStock"
  | "photo";

export type ProductColumnDefinition = {
  key: ProductColumnKey;
  /** Header written by the export (the historical one when it exists). */
  header: string;
  /** Other spellings accepted at import (compared case / accent / "_" insensitive). */
  aliases: readonly string[];
  label: string;
  kind: TableColumn["kind"];
  defaultSelected: boolean;
  /** Always exported (the identifier). */
  locked?: boolean;
  /** Needed to CREATE a product in another organisation. */
  requiredToCreate?: boolean;
};

export const PRODUCT_COLUMNS: readonly ProductColumnDefinition[] = [
  { key: "reference", header: "ref_produit", aliases: ["reference", "référence produit"], label: "Référence produit", kind: "text", defaultSelected: true, locked: true },
  { key: "name", header: "designation", aliases: ["désignation"], label: "Désignation", kind: "text", defaultSelected: true, requiredToCreate: true },
  { key: "categoryName", header: "type", aliases: ["categorie", "catégorie"], label: "Catégorie", kind: "text", defaultSelected: true, requiredToCreate: true },
  { key: "supplierCode", header: "ref_fournisseur", aliases: ["code fournisseur"], label: "Fournisseur (code)", kind: "text", defaultSelected: true, requiredToCreate: true },
  { key: "supplierName", header: "nom_fournisseur", aliases: ["fournisseur"], label: "Fournisseur (nom)", kind: "text", defaultSelected: true },
  { key: "purchasePriceTTC", header: "prixAchatTTC", aliases: ["prix achat ttc"], label: "Prix d'achat TTC", kind: "number", defaultSelected: true, requiredToCreate: true },
  { key: "salePriceTTC", header: "prixGros", aliases: ["prix_gros", "prix gros ttc", "prix de vente ttc"], label: "Prix de vente TTC (gros)", kind: "number", defaultSelected: true, requiredToCreate: true },
  { key: "retailPriceTTC", header: "prix_detail", aliases: ["prix detail ttc"], label: "Prix détail TTC", kind: "number", defaultSelected: true },
  { key: "semiWholesalePriceTTC", header: "prix_semi_gros", aliases: ["prix semi gros ttc"], label: "Prix semi-gros TTC", kind: "number", defaultSelected: true },
  { key: "semiWholesaleMinQty", header: "Qped", aliases: [], label: "Seuil semi-gros (Qped)", kind: "number", defaultSelected: true },
  { key: "wholesaleMinQty", header: "Qgros", aliases: [], label: "Seuil gros (Qgros)", kind: "number", defaultSelected: true },
  { key: "taxRate", header: "taux_tva", aliases: ["tva"], label: "TVA (%)", kind: "number", defaultSelected: true, requiredToCreate: true },
  { key: "unit", header: "unite", aliases: ["unité"], label: "Unité", kind: "text", defaultSelected: true },
  { key: "barcode", header: "code_barre", aliases: ["code-barres", "codebarre", "barcode"], label: "Code-barres", kind: "text", defaultSelected: true },
  { key: "brandName", header: "marque", aliases: ["brand"], label: "Marque", kind: "text", defaultSelected: true },
  { key: "description", header: "description", aliases: [], label: "Description", kind: "text", defaultSelected: true },
  { key: "minimumStock", header: "stock_min", aliases: ["stock minimum"], label: "Stock minimum", kind: "number", defaultSelected: true },
  { key: "status", header: "statut", aliases: ["status"], label: "Statut", kind: "text", defaultSelected: true },
  { key: "targetStock", header: "QuantiteStock", aliases: ["quantité stock", "quantite en stock"], label: "Quantité en stock (dépôt)", kind: "number", defaultSelected: false },
  { key: "photo", header: "photo", aliases: ["image"], label: "Photo", kind: "text", defaultSelected: false },
];

export const PRODUCT_SHEET_NAME = "produits";

export function productColumn(key: ProductColumnKey): ProductColumnDefinition {
  return PRODUCT_COLUMNS.find((column) => column.key === key)!;
}

/** The columns to write, in the format's order, whatever order they were ticked in (reference always included). */
export function orderedProductColumns(selected: Iterable<ProductColumnKey>): ProductColumnDefinition[] {
  const wanted = new Set(selected);
  return PRODUCT_COLUMNS.filter((column) => column.locked || wanted.has(column.key));
}

// ---------------------------------------------------------------- export

/** One product as the export API gives it - business values only, never an id. */
export type ProductExportRow = {
  reference: string;
  name: string;
  categoryName: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  purchasePriceTTC: number;
  salePriceTTC: number;
  retailPriceTTC: number | null;
  semiWholesalePriceTTC: number | null;
  semiWholesaleMinQty: number | null;
  wholesaleMinQty: number | null;
  taxRate: number;
  unit: string;
  barcode: string | null;
  brandName: string | null;
  description: string | null;
  minimumStock: number;
  status: ProductStatusCode;
  /** Stock of the exporting user's depot (the importer's semantics); null when not requested / no depot. */
  depotStock: number | null;
  /** "stored" = a photo kept in the app (exported only inside a ZIP); "url" = an external URL; null = none. */
  photo: { kind: "stored" } | { kind: "url"; url: string } | null;
};

/** The cells of one product for the chosen columns. `photoCell` is the archive path or URL decided by the caller. */
export function productExportCells(row: ProductExportRow, columns: readonly ProductColumnDefinition[], photoCell: string | null): CellValue[] {
  return columns.map((column) => {
    switch (column.key) {
      case "reference":
        return row.reference;
      case "name":
        return row.name;
      case "categoryName":
        return row.categoryName;
      case "supplierCode":
        return row.supplierCode;
      case "supplierName":
        return row.supplierName;
      case "purchasePriceTTC":
        return row.purchasePriceTTC;
      case "salePriceTTC":
        return row.salePriceTTC;
      case "retailPriceTTC":
        return row.retailPriceTTC;
      case "semiWholesalePriceTTC":
        return row.semiWholesalePriceTTC;
      case "semiWholesaleMinQty":
        return row.semiWholesaleMinQty;
      case "wholesaleMinQty":
        return row.wholesaleMinQty;
      case "taxRate":
        return row.taxRate;
      case "unit":
        return row.unit;
      case "barcode":
        return row.barcode;
      case "brandName":
        return row.brandName;
      case "description":
        return row.description;
      case "minimumStock":
        return row.minimumStock;
      case "status":
        return PRODUCT_STATUS_LABELS[row.status];
      case "targetStock":
        return row.depotStock;
      case "photo":
        return photoCell;
    }
  });
}

// ---------------------------------------------------------------- import

export type ParsedProductLine = {
  line: ProductImportLine;
  /** Value of the `photo` column when it is a path inside the archive (photos/...). */
  photoPath?: string;
  errors: string[];
  /** Variants format only: suspicious but not blocking (e.g. a barcode that may have lost a leading zero). */
  warnings?: string[];
};

/** "historical" = the file carries ref_produit; "variants" = the 7-column format with attributes. */
export type ProductFileFormat = "historical" | "variants";

export type ParsedProductTable = {
  /** Columns found in the file. */
  present: Set<ProductColumnKey>;
  lines: ParsedProductLine[];
  /** Set when the file cannot be imported at all (e.g. no ref_produit column). */
  fatal?: string;
  /** Set only by parseProductGrid (the historical parseProductTable never sets them). */
  format?: ProductFileFormat;
  /** The first row of the file was data (no header line): the columns were read by position. */
  headerless?: boolean;
  /** How a header-less file was read, in plain words (shown before the preview). */
  columnsNotice?: string;
};

const STATUS_BY_KEY: Record<string, ProductStatusCode> = {
  actif: "ACTIVE",
  active: "ACTIVE",
  disponible: "ACTIVE",
  inactif: "INACTIVE",
  inactive: "INACTIVE",
  indisponible: "INACTIVE",
  arrete: "DISCONTINUED",
  discontinued: "DISCONTINUED",
};

function statusFromCell(value: unknown): ProductStatusCode | null | undefined {
  const text = readText(value);
  if (text === undefined) return undefined;
  const key = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
  return STATUS_BY_KEY[key] ?? null;
}

/**
 * taux_tva stays a PERCENTAGE (20 = 20 %), exactly as the historical import read
 * it: "20", "20%", "20,00 %", the number 20, and a cell formatted as a percentage
 * (read as 0.2) all mean 20.
 */
function taxRateFromCell(value: unknown): number | null | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1) return value * 100;
  return readDecimal(value);
}

type ColumnIndex = ReadonlyMap<ProductColumnKey, number>;

function historicalColumnIndex(headers: readonly unknown[]): Map<ProductColumnKey, number> {
  const index = new Map<ProductColumnKey, number>();
  for (const column of PRODUCT_COLUMNS) {
    const found = findColumn(headers, [column.header, ...column.aliases]);
    if (found >= 0) index.set(column.key, found);
  }
  return index;
}

/**
 * The line reader shared by both formats. `variantColumn` set = the variants
 * format: there is no reference column, so the reference is the barcode or a
 * deterministic generated one, the designation is the PARENT name, the variant
 * cell is read into structured attributes, and the display name becomes
 * "Parent - S / NOIR". Without it (the historical format) every rule is exactly
 * what it has always been: ref_produit required, barcode read as plain text.
 */
function parseProductLines(index: ColumnIndex, variantColumn: number | undefined, rows: readonly TableRow[]): ParsedProductLine[] {
  const variantsFormat = variantColumn !== undefined;
  const lines: ParsedProductLine[] = [];
  const variantInfo: Array<{ parsed: ParsedProductLine; parentName: string; attributes?: VariantAttribute[]; hasVariantCell: boolean }> = [];

  for (const row of rows) {
    const cell = (key: ProductColumnKey) => (index.has(key) ? row.cells[index.get(key)!] : undefined);
    const errors: string[] = [];
    const warnings: string[] = [];
    const reference = readText(cell("reference")) ?? "";
    if (!reference && !variantsFormat) errors.push("ref_produit manquant");
    const line: ProductImportLine = { excelRow: row.line, reference };

    const text = (key: "name" | "categoryName" | "supplierCode" | "supplierName" | "barcode" | "brandName" | "description" | "unit", max = 500) => {
      const value = readText(cell(key));
      if (value === undefined) return;
      if (value.length > max) errors.push(`${productColumn(key).header} trop long (${max} caractères maximum)`);
      else line[key] = value;
    };
    text("name", 200);
    text("categoryName", 120);
    text("supplierCode", 60);
    text("supplierName", 160);
    if (variantsFormat) {
      // A barcode is an identifier: kept exact, and a cell the spreadsheet may have damaged is refused.
      const barcode = readBarcode(cell("barcode"));
      if (barcode.error) errors.push(barcode.error);
      else if (barcode.value !== undefined) {
        if (barcode.value.length > 80) errors.push(`${productColumn("barcode").header} trop long (80 caractères maximum)`);
        else line.barcode = barcode.value;
      }
      if (barcode.warning) warnings.push(barcode.warning);
    } else {
      text("barcode", 80);
    }
    text("brandName", 120);
    text("description", 2000);
    text("unit", IMPORT_UNIT_MAX_LENGTH);

    for (const key of ["purchasePriceTTC", "salePriceTTC", "retailPriceTTC", "semiWholesalePriceTTC"] as const) {
      const value = readDecimal(cell(key));
      if (value === undefined) continue;
      if (value === null || value < 0 || value > MONEY_RANGE_MAX_NUMBER) errors.push(`${productColumn(key).header} invalide (nombre positif ou nul attendu)`);
      else line[key] = value;
    }
    const taxRate = taxRateFromCell(cell("taxRate"));
    if (taxRate !== undefined) {
      if (taxRate === null || taxRate < 0 || taxRate > 100) errors.push("taux_tva invalide (pourcentage entre 0 et 100 attendu)");
      else line.taxRate = taxRate;
    }
    for (const key of ["semiWholesaleMinQty", "wholesaleMinQty"] as const) {
      const value = readInteger(cell(key));
      if (value === undefined) continue;
      if (value === null || value < 1 || value > IMPORT_TIER_THRESHOLD_MAX) errors.push(`${productColumn(key).header} invalide (quantité entière ≥ 1 attendue)`);
      else line[key] = value;
    }
    const thresholds = tierThresholdsError(line.semiWholesaleMinQty, line.wholesaleMinQty);
    if (thresholds) errors.push(thresholds);
    const minimumStock = readInteger(cell("minimumStock"));
    if (minimumStock !== undefined) {
      if (minimumStock === null || minimumStock < 0 || minimumStock > IMPORT_TIER_THRESHOLD_MAX) errors.push("stock_min invalide (entier positif ou nul attendu)");
      else line.minimumStock = minimumStock;
    }
    const targetStock = readInteger(cell("targetStock"));
    if (targetStock !== undefined) {
      if (targetStock === null || Math.abs(targetStock) > IMPORT_TIER_THRESHOLD_MAX) errors.push("QuantiteStock invalide (entier attendu)");
      else line.targetStock = targetStock;
    }
    const status = statusFromCell(cell("status"));
    if (status === null) errors.push("statut invalide (Actif, Inactif ou Arrêté attendu)");
    else if (status) line.productStatus = status;

    let photoPath: string | undefined;
    const photo = readText(cell("photo"));
    if (photo !== undefined) {
      if (/^https?:\/\//i.test(photo)) {
        if (isPortablePhotoUrl(photo)) line.imageUrl = photo;
        else errors.push("photo : URL de photo protégée de l'application (non réutilisable) - exportez au format ZIP");
      } else {
        const path = safeArchivePath(photo);
        if (!path) errors.push("photo : chemin d'image invalide dans l'archive");
        else photoPath = path;
      }
    }

    // A line with nothing at all in it (only formatting) is not a line.
    if (!variantsFormat && !reference && row.cells.every(isBlankCell)) continue;
    if (variantsFormat && row.cells.every(isBlankCell)) continue;

    const parsed: ParsedProductLine = { line, photoPath, errors };
    if (warnings.length) parsed.warnings = warnings;
    lines.push(parsed);

    if (variantsFormat) {
      const parentName = line.name ?? "";
      if (!parentName && !errors.some((message) => message.startsWith("designation trop long"))) errors.push("designation manquante");
      const variantCell = readText(row.cells[variantColumn!]);
      const hasVariantCell = variantCell !== undefined;
      let attributes: VariantAttribute[] | undefined;
      if (hasVariantCell) {
        const result = parseVariantAttributes(variantCell);
        if (result.errors.length) {
          errors.push(...result.errors);
          line.variantRaw = variantCell;
        } else {
          attributes = result.attributes;
        }
      }
      variantInfo.push({ parsed, parentName, attributes, hasVariantCell });
    }
  }

  if (variantsFormat) finalizeVariantLines(variantInfo);
  return lines;
}

/**
 * Whole-file step of the variants format, once every line is read: within a
 * file group (same parent + same category) the spelling of the parent, of the
 * attribute names and of the values is unified on the first occurrence, then
 * every line gets its display name ("Arsenal Survêtements - S / NOIR") and, when
 * the file gives no reference, its deterministic one.
 */
function finalizeVariantLines(
  entries: Array<{ parsed: ParsedProductLine; parentName: string; attributes?: VariantAttribute[]; hasVariantCell: boolean }>,
): void {
  const variants = entries.filter((entry) => entry.parentName && entry.attributes && entry.attributes.length > 0);
  const canonical = canonicalizeVariantGroups(
    variants.map((entry) => ({
      groupKey: variantFileGroupKey(entry.parentName, entry.parsed.line.categoryName),
      parentName: entry.parentName,
      attributes: entry.attributes!,
    })),
  );
  const variantEntries = new Set(variants);

  variants.forEach((entry, position) => {
    const { line } = entry.parsed;
    const { parentName, attributes } = canonical[position];
    line.variantParentName = parentName;
    line.variantAttributes = attributes;
    line.name = variantDisplayName(parentName, attributes);
    if (line.name.length > VARIANT_LIMITS.maxProductNameLength) {
      entry.parsed.errors.push(`Désignation trop longue (${VARIANT_LIMITS.maxProductNameLength} caractères maximum) : « ${line.name} ».`);
    }
    const reference = deriveVariantReference({ barcode: line.barcode, parentName, categoryName: line.categoryName, attributes });
    line.reference = reference.reference;
    line.referenceSource = reference.source;
  });

  for (const entry of entries) {
    if (variantEntries.has(entry) || !entry.parentName) continue;
    const { line } = entry.parsed;
    if (entry.hasVariantCell) {
      // A variant cell that could not be read: the product is blocked later; a barcode still identifies the line.
      if (line.barcode) {
        line.reference = line.barcode;
        line.referenceSource = "barcode";
      }
      continue;
    }
    const reference = deriveSimpleReference({ barcode: line.barcode, name: entry.parentName, categoryName: line.categoryName });
    line.reference = reference.reference;
    line.referenceSource = reference.source;
  }
}

/** Reads the file's rows into import lines (+ per-line errors). Never sends a value for an empty cell. */
export function parseProductTable(headers: readonly unknown[], rows: readonly TableRow[]): ParsedProductTable {
  const index = historicalColumnIndex(headers);
  const present = new Set(index.keys());
  if (!present.has("reference")) {
    return { present, lines: [], fatal: "Colonne obligatoire absente : ref_produit (référence du produit)." };
  }
  return { present, lines: parseProductLines(index, undefined, rows) };
}

// ---------------------------------------------------------------- the variants format

/**
 * The variants format has 7 columns, in this order, with or without a header
 * line:  designation, code-barres, catégorie, prix d'achat TTC, prix de vente
 * TTC, stock, variantes ("TAILLE: S | COULEUR: NOIR"). It has no ref_produit,
 * no supplier and no VAT: the reference is derived, the other two are chosen on
 * the import page.
 */
const POSITIONAL_COLUMNS: ReadonlyArray<ProductColumnKey | "variants"> = [
  "name",
  "barcode",
  "categoryName",
  "purchasePriceTTC",
  "salePriceTTC",
  "targetStock",
  "variants",
];
const POSITIONAL_WIDTH = POSITIONAL_COLUMNS.length;

/** Headers of the variant cell (compared case / accent / "_" insensitive, like every header). */
const VARIANT_COLUMN_ALIASES = ["variantes", "variante", "valeursVariante", "attributs"] as const;

/** Extra spellings accepted for the columns of the variants format when it has a header line. */
const VARIANT_FORMAT_ALIASES: Partial<Record<ProductColumnKey, readonly string[]>> = {
  name: ["nom", "produit", "name"],
  barcode: ["ean", "gtin"],
  categoryName: ["category"],
  purchasePriceTTC: ["prixAchat", "cout", "coût"],
  salePriceTTC: ["prixVente", "prix vente", "prix"],
  targetStock: ["quantiteDisponible", "stock", "quantite", "quantité", "qte"],
};

const POSITIONAL_LABELS = "désignation, code-barres, catégorie, prix d'achat TTC, prix de vente TTC, stock, variantes";
const VARIANTS_FORMAT_HINT = ` Pour un fichier avec variantes : 7 colonnes sans en-tête (${POSITIONAL_LABELS}) ou une colonne « variantes ».`;

const KNOWN_HEADER_KEYS: ReadonlySet<string> = new Set([
  ...PRODUCT_COLUMNS.flatMap((column) => [column.header, ...column.aliases]),
  ...Object.values(VARIANT_FORMAT_ALIASES).flat(),
  ...VARIANT_COLUMN_ALIASES,
].map(headerKey));

/** A row is a header line when at least two of its cells are known column names. */
function looksLikeHeader(cells: readonly unknown[]): boolean {
  const known = new Set(cells.map(headerKey).filter((key) => KNOWN_HEADER_KEYS.has(key)));
  return known.size >= 2;
}

function variantsColumnIndex(headers: readonly unknown[]): { index: Map<ProductColumnKey, number>; variantColumn: number } | null {
  const index = new Map<ProductColumnKey, number>();
  for (const column of PRODUCT_COLUMNS) {
    if (column.key === "reference") continue;
    const found = findColumn(headers, [column.header, ...column.aliases, ...(VARIANT_FORMAT_ALIASES[column.key] ?? [])]);
    if (found >= 0) index.set(column.key, found);
  }
  const variantColumn = findColumn(headers, VARIANT_COLUMN_ALIASES);
  return variantColumn >= 0 && index.has("name") ? { index, variantColumn } : null;
}

/** Index of the last non-empty cell of a row, +1 (0 for an empty row). */
const effectiveWidth = (cells: readonly unknown[]) => {
  let last = cells.length - 1;
  while (last >= 0 && isBlankCell(cells[last])) last -= 1;
  return last + 1;
};

/** Rows examined to recognise a file without header line (prices / stock of a single row can be empty). */
const POSITIONAL_SAMPLE_ROWS = 50;

type PositionalVerdict = { ok: true } | { ok: false; reason?: string };

/**
 * Whether a file WITHOUT header line is the 7-column variants format. Nothing
 * is guessed; the file must show ALL of this:
 *   - the 7 columns: 7 filled columns on at least one row - or, when the
 *     « variantes » column is empty on every row, rows that are exactly 7 cells
 *     wide with the 6 first columns filled somewhere (a trailing empty column
 *     is still a column in a CSV);
 *   - a first row that is not a header line (so a header with names we do not
 *     know is never imported as a product);
 *   - price / stock cells (columns 4-6) of the first rows that are numbers or
 *     empty, the first row included, at least half of the rows being valid, and at
 *     least one real number: a first row without price or stock is allowed
 *     when the following rows give that evidence.
 * Otherwise the file is refused (with the reason when there is one). No loop
 * spreads the rows into function arguments: a file of any length is handled.
 */
function positionalVerdict(grid: readonly unknown[][]): PositionalVerdict {
  let filledRows = 0;
  let maxEffective = 0;
  let maxLength = 0;
  for (const cells of grid) {
    if (!cells.some((cell) => !isBlankCell(cell))) continue;
    filledRows += 1;
    const effective = effectiveWidth(cells);
    if (effective > maxEffective) maxEffective = effective;
    if (cells.length > maxLength) maxLength = cells.length;
  }
  if (!filledRows) return { ok: false };
  const sevenColumns = maxEffective === POSITIONAL_WIDTH;
  const variantsColumnEmpty = maxEffective === POSITIONAL_WIDTH - 1 && maxLength === POSITIONAL_WIDTH;
  if (!sevenColumns && !variantsColumnEmpty) return { ok: false };

  const sample: unknown[][] = [];
  for (const cells of grid) {
    if (sample.length >= POSITIONAL_SAMPLE_ROWS) break;
    if (cells.some((cell) => !isBlankCell(cell))) sample.push(cells);
  }
  if (looksLikeHeader(sample[0])) return { ok: false };

  let valid = 0;
  let numeric = 0;
  let firstIsValid = false;
  sample.forEach((cells, position) => {
    const values = [readDecimal(cells[3]), readDecimal(cells[4]), readInteger(cells[5])];
    const rowValid = values.every((value) => value !== null);
    if (rowValid) valid += 1;
    if (rowValid && values.some((value) => typeof value === "number")) numeric += 1;
    if (position === 0) firstIsValid = rowValid;
  });
  if (firstIsValid && numeric > 0 && valid * 2 >= sample.length) return { ok: true };
  return {
    ok: false,
    reason: " Fichier sans en-tête non reconnu : les colonnes prix d'achat, prix de vente et stock des premières lignes doivent contenir des nombres (ou rester vides).",
  };
}

/**
 * Recognises the format of a whole file (its rows as they are, the first one
 * included) and reads it:
 *   1. a header line with ref_produit -> the HISTORICAL format, read by
 *      parseProductTable exactly as it has always been (a "variantes" column in
 *      such a file is ignored, as before);
 *   2. a header line without ref_produit but with a designation column and a
 *      "variantes" column -> the variants format;
 *   3. no header line but the 7 columns of the variants format, recognised on
 *      several rows (see positionalVerdict) - never guessed;
 *   4. anything else is refused with the historical message (+ a hint). A
 *      historical file that merely lost its ref_produit column is NEVER read as
 *      the variants format: it would create every product again.
 */
export function parseProductGrid(grid: readonly unknown[][]): ParsedProductTable {
  const headers = grid[0] ?? [];
  const refused = (reason = ""): ParsedProductTable => ({
    present: new Set(),
    lines: [],
    format: "historical",
    headerless: false,
    fatal: `Colonne obligatoire absente : ref_produit (référence du produit).${reason}${VARIANTS_FORMAT_HINT}`,
  });

  if (historicalColumnIndex(headers).has("reference")) {
    return { ...parseProductTable(headers, tableFromGrid(grid).rows), format: "historical", headerless: false };
  }

  if (looksLikeHeader(headers)) {
    const found = variantsColumnIndex(headers);
    if (!found) return refused();
    return {
      present: new Set(found.index.keys()),
      lines: parseProductLines(found.index, found.variantColumn, tableFromGrid(grid).rows),
      format: "variants",
      headerless: false,
    };
  }

  const verdict = positionalVerdict(grid);
  if (verdict.ok) {
    const index = new Map<ProductColumnKey, number>();
    POSITIONAL_COLUMNS.forEach((key, position) => {
      if (key !== "variants") index.set(key, position);
    });
    // No header line: the first row is data, so line numbers start at 1.
    const rows: TableRow[] = grid
      .map((cells, position) => ({ line: position + 1, cells }))
      .filter((row) => row.cells.some((cell) => !isBlankCell(cell)));
    return {
      present: new Set(index.keys()),
      lines: parseProductLines(index, POSITIONAL_COLUMNS.indexOf("variants"), rows),
      format: "variants",
      headerless: true,
      columnsNotice: `Fichier sans en-tête lu dans cet ordre : ${POSITIONAL_LABELS}.`,
    };
  }

  return refused(verdict.reason);
}

/** The headers a file needs to CREATE products that do not exist yet (for the preview message). */
export function missingCreationHeaders(line: ProductImportLine): string[] {
  const missing: string[] = [];
  if (line.name === undefined) missing.push("designation");
  if (line.categoryName === undefined) missing.push("type");
  if (line.supplierCode === undefined) missing.push("ref_fournisseur");
  if (line.purchasePriceTTC === undefined) missing.push("prixAchatTTC");
  if (line.salePriceTTC === undefined) missing.push("prixGros");
  if (line.taxRate === undefined) missing.push("taux_tva");
  return missing;
}
