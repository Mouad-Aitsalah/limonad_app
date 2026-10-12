import { findColumn, isBlankCell, readDecimal, readInteger, readText } from "@/lib/import-export/cells";
import { isPortablePhotoUrl } from "@/lib/import-export/images";
import type { CellValue, TableColumn, TableRow } from "@/lib/import-export/tabular";
import { safeArchivePath } from "@/lib/import-export/zip";
import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { IMPORT_TIER_THRESHOLD_MAX, IMPORT_UNIT_MAX_LENGTH, tierThresholdsError } from "@/lib/products-import-pricing";

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
};

export type ParsedProductTable = {
  /** Columns found in the file. */
  present: Set<ProductColumnKey>;
  lines: ParsedProductLine[];
  /** Set when the file cannot be imported at all (e.g. no ref_produit column). */
  fatal?: string;
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

/** Reads the file's rows into import lines (+ per-line errors). Never sends a value for an empty cell. */
export function parseProductTable(headers: readonly unknown[], rows: readonly TableRow[]): ParsedProductTable {
  const index = new Map<ProductColumnKey, number>();
  for (const column of PRODUCT_COLUMNS) {
    const found = findColumn(headers, [column.header, ...column.aliases]);
    if (found >= 0) index.set(column.key, found);
  }
  const present = new Set(index.keys());
  if (!present.has("reference")) {
    return { present, lines: [], fatal: "Colonne obligatoire absente : ref_produit (référence du produit)." };
  }

  const lines: ParsedProductLine[] = [];
  for (const row of rows) {
    const cell = (key: ProductColumnKey) => (index.has(key) ? row.cells[index.get(key)!] : undefined);
    const errors: string[] = [];
    const reference = readText(cell("reference")) ?? "";
    if (!reference) errors.push("ref_produit manquant");
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
    text("barcode", 80);
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
    if (!reference && row.cells.every(isBlankCell)) continue;
    lines.push({ line, photoPath, errors });
  }
  return { present, lines };
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
