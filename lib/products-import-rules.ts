import { z } from "zod";

import { MONEY_RANGE_MAX_NUMBER, roundMoney } from "@/lib/money";
import { computePriceHTFromTTC } from "@/lib/product-pricing";
import {
  IMPORT_TIER_THRESHOLD_MAX,
  IMPORT_UNIT_MAX_LENGTH,
  tierThresholdsError,
} from "@/lib/products-import-pricing";
import {
  PRODUCT_IMPORT_BATCH_MAX_ROWS,
  PRODUCT_IMPORT_MAX_ROWS,
  importBatchLimitMessage,
  importRowLimitMessage,
} from "@/lib/products-import-shared";

/**
 * The business rules of the products import (feuille "produits", CSV, or the
 * data file of a ZIP), with no database and no "server-only": the row contract
 * and the pure comparison of a file line against what is already stored.
 * lib/server/products-import.ts preloads the stored data (one grouped query per
 * table) and calls classifyPreloadedRows; both endpoints (preview and batch
 * write) go through it, so they can never drift apart.
 *
 * RULE OF THE COLUMNS (export / import round trip): only `reference` is always
 * required. Every other field is optional - a column absent from the file or a
 * cell left empty is simply not sent, and the stored value is KEPT. A product
 * that does not exist yet in the organisation still needs its creation fields
 * (name, category, supplier, both prices, VAT): without them the line is an
 * ERROR naming the missing columns. A file with the historical columns behaves
 * exactly as before.
 *
 * STOCK: QuantiteStock is a TARGET for the importer's depot. It is compared and
 * written only when `applyStock` is on (the import page asks for an explicit
 * confirmation); otherwise a different stock is only REPORTED (pendingStock) so
 * an old export can never silently overwrite today's stock.
 */

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const optionalMoney = () => z.number().finite().min(0).max(MONEY_RANGE_MAX_NUMBER).optional();

export const productImportRowSchema = z.object({
  excelRow: z.number().int().positive(),
  reference: z.string().trim().min(1),
  supplierCode: optionalText(60),
  supplierName: optionalText(160),
  name: optionalText(200),
  categoryName: optionalText(120),
  // Prices are the tax-INCLUDED values from the file; HT is derived below.
  purchasePriceTTC: optionalMoney(),
  salePriceTTC: optionalMoney(),
  // Percentage, never a fraction: 20 = 20 %.
  taxRate: z.number().finite().min(0).max(100).optional(),
  // Target stock in the depot. Integer, MAY be negative (§12).
  targetStock: z.number().int().min(-IMPORT_TIER_THRESHOLD_MAX).max(IMPORT_TIER_THRESHOLD_MAX).optional(),
  retailPriceTTC: optionalMoney(),
  semiWholesalePriceTTC: optionalMoney(),
  semiWholesaleMinQty: z.number().int().min(1).max(IMPORT_TIER_THRESHOLD_MAX).optional(),
  wholesaleMinQty: z.number().int().min(1).max(IMPORT_TIER_THRESHOLD_MAX).optional(),
  unit: z.string().trim().min(1).max(IMPORT_UNIT_MAX_LENGTH).optional(),
  barcode: optionalText(80),
  brandName: optionalText(120),
  description: optionalText(2000),
  minimumStock: z.number().int().min(0).max(IMPORT_TIER_THRESHOLD_MAX).optional(),
  productStatus: z.enum(["ACTIVE", "INACTIVE", "DISCONTINUED"]).optional(),
  // An external http(s) photo URL only (a ZIP photo is sent separately, see /api/produits/import/photos).
  imageUrl: z.string().trim().url().max(2000).regex(/^https?:\/\//i).optional(),
});

/** The whole file, for the read-only preview (global conflict detection). */
export const productImportSchema = z.object({
  rows: z.array(productImportRowSchema).max(PRODUCT_IMPORT_MAX_ROWS),
  applyStock: z.boolean().optional(),
});

/** One batch of the real write: a few hundred lines, never the whole file. */
export const productImportBatchSchema = z.object({
  rows: z.array(productImportRowSchema).max(PRODUCT_IMPORT_BATCH_MAX_ROWS),
  applyStock: z.boolean().optional(),
});

/**
 * The message of a refused import request, instead of a bare "Lignes import
 * invalides.": a file / batch over the line limit says how many lines it has and
 * what the maximum is; a bad cell names its Excel line and field.
 */
export function describeImportValidationError(
  error: z.ZodError,
  body: unknown,
  kind: "file" | "batch" = "file",
): string {
  const rowsInput = (body as { rows?: unknown } | null)?.rows;
  const rowCount = Array.isArray(rowsInput) ? rowsInput.length : 0;

  const tooMany = error.issues.some(
    (issue) => issue.code === "too_big" && issue.path.length === 1 && issue.path[0] === "rows",
  );
  if (tooMany) return kind === "batch" ? importBatchLimitMessage(rowCount) : importRowLimitMessage(rowCount);

  const issue = error.issues[0];
  if (issue && issue.path[0] === "rows" && typeof issue.path[1] === "number" && Array.isArray(rowsInput)) {
    const raw = rowsInput[issue.path[1]] as { excelRow?: unknown } | null | undefined;
    const line = typeof raw?.excelRow === "number" ? raw.excelRow : issue.path[1] + 2;
    const field = typeof issue.path[2] === "string" ? ` (champ ${issue.path[2]})` : "";
    return `Lignes import invalides : ligne Excel ${line}${field}.`;
  }
  return "Lignes import invalides.";
}

export type ProductImportRow = z.infer<typeof productImportRowSchema>;

export type ProductImportStatus =
  | "NEW"
  | "EXISTING_UNCHANGED"
  | "EXISTING_UPDATE"
  | "CONFLICT"
  | "ERROR";

export type ProductImportChange = { old: string | null; new: string | null };

export type ClassifiedProductRow = ProductImportRow & {
  /** Derived tax-excluded prices (computePriceHTFromTTC, same convention as the
   * product form + /achats) - undefined when the file has no such price. */
  purchasePriceHT?: number;
  salePriceHT?: number;
  retailPriceHT?: number;
  semiWholesalePriceHT?: number;
  /** Resolved existing supplier id, or null when it will be created / is not in the file. */
  supplierId: string | null;
  /** Name of the existing supplier the code resolved to (null when created / not in the file). */
  resolvedSupplierName: string | null;
  /** The file names a supplier code unknown to the organisation: the import creates it. */
  supplierCreate: boolean;
  /** Resolved existing category id, or null when it will be created / is not in the file. */
  categoryId: string | null;
  categoryCreate: boolean;
  /** Resolved existing brand id, or null when it will be created / is not in the file. */
  brandId: string | null;
  brandCreate: boolean;
  /** Depot stock today; null for a brand-new product. */
  currentStock: number | null;
  /** The depot stock target to WRITE (only when applyStock is on and it differs). */
  stockToApply?: number;
  /** A different stock found in the file while applyStock is off: reported, never written. */
  pendingStock: ProductImportChange | null;
  /** Existing Product id (only for EXISTING_*). Always from the org-scoped
   * preload, never from the request body. */
  existingId: string | null;
  status: ProductImportStatus;
  message: string;
  changes: Record<string, ProductImportChange>;
};

export type ProductImportSummary = {
  total: number;
  new: number;
  unchanged: number;
  update: number;
  conflicts: number;
  errors: number;
};

/**
 * The optional Product fields a classified line writes (quantity tiers + unit):
 * ONLY those the file carries (absent column / empty cell -> the key is absent ->
 * the stored value is kept). Prices are the derived HT. Unchanged contract.
 */
export function importedOptionalProductFields(row: ClassifiedProductRow): {
  retailPrice?: number;
  semiWholesalePrice?: number;
  semiWholesaleMinQty?: number;
  wholesaleMinQty?: number;
  unit?: string;
} {
  return {
    ...(row.retailPriceHT !== undefined ? { retailPrice: row.retailPriceHT } : {}),
    ...(row.semiWholesalePriceHT !== undefined ? { semiWholesalePrice: row.semiWholesalePriceHT } : {}),
    ...(row.semiWholesaleMinQty !== undefined ? { semiWholesaleMinQty: row.semiWholesaleMinQty } : {}),
    ...(row.wholesaleMinQty !== undefined ? { wholesaleMinQty: row.wholesaleMinQty } : {}),
    ...(row.unit !== undefined ? { unit: row.unit } : {}),
  };
}

/**
 * EVERY Product field a classified line writes - the historical ones (name, both
 * prices, VAT) and the newer optional ones - again ONLY those the file carries,
 * so an update never overwrites a field absent from the file. The relations
 * (category, supplier, brand) are written by the store, also only when named.
 */
export function importedProductFields(row: ClassifiedProductRow): ReturnType<typeof importedOptionalProductFields> & {
  name?: string;
  purchasePrice?: number;
  salePrice?: number;
  taxRate?: number;
  barcode?: string;
  description?: string;
  minimumStock?: number;
  status?: "ACTIVE" | "INACTIVE" | "DISCONTINUED";
  imageUrl?: string;
} {
  return {
    ...(row.name !== undefined ? { name: row.name } : {}),
    ...(row.purchasePriceHT !== undefined ? { purchasePrice: row.purchasePriceHT } : {}),
    ...(row.salePriceHT !== undefined ? { salePrice: row.salePriceHT } : {}),
    ...(row.taxRate !== undefined ? { taxRate: row.taxRate } : {}),
    ...importedOptionalProductFields(row),
    ...(row.barcode !== undefined ? { barcode: row.barcode } : {}),
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.minimumStock !== undefined ? { minimumStock: row.minimumStock } : {}),
    ...(row.productStatus !== undefined ? { status: row.productStatus } : {}),
    ...(row.imageUrl !== undefined ? { imageUrl: row.imageUrl } : {}),
  };
}

/** trim + lowercase + collapse spaces, so "Jus", " jus ", "JUS" collide. */
export function normalizeCategoryKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** What the server preloads (one grouped query per table) before comparing. */
export type ProductImportPreload = {
  products: {
    id: string;
    reference: string;
    name: string;
    defaultSupplierId: string | null;
    defaultSupplierName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    purchasePrice: number;
    salePrice: number;
    taxRate: number;
    /** Optional fields (absent from a preload written before them = null / "unité"). */
    retailPrice?: number | null;
    semiWholesalePrice?: number | null;
    semiWholesaleMinQty?: number | null;
    wholesaleMinQty?: number | null;
    unit?: string;
    barcode?: string | null;
    brandId?: string | null;
    brandName?: string | null;
    description?: string | null;
    minimumStock?: number;
    status?: string;
    /** Loaded only for products whose line carries an external photo URL. */
    imageUrl?: string | null;
  }[];
  suppliers: { id: string; code: string; name: string; active: boolean }[];
  categories: { id: string; name: string }[];
  /** The organisation's brands (matched case-insensitively by name). */
  brands?: { id: string; name: string }[];
  /** Products of the organisation holding a barcode the file uses: barcode -> reference. */
  barcodeOwners?: Map<string, string>;
  /** Depot stock per existing product id. */
  stockByProduct: Map<string, number>;
};

const money2 = (value: number) => roundMoney(value);

/** The columns a line must carry to CREATE a product (named as in the file). */
function missingCreationFields(row: ProductImportRow): string[] {
  const missing: string[] = [];
  if (row.name === undefined) missing.push("designation");
  if (row.categoryName === undefined) missing.push("type");
  if (row.supplierCode === undefined) missing.push("ref_fournisseur");
  if (row.purchasePriceTTC === undefined) missing.push("prixAchatTTC");
  if (row.salePriceTTC === undefined) missing.push("prixGros");
  if (row.taxRate === undefined) missing.push("taux_tva");
  return missing;
}

/**
 * A pure in-memory compare (no database, no N+1):
 *   - reference used twice in the file            -> CONFLICT (both rows)
 *   - barcode used twice in the file, or by another product of the organisation -> CONFLICT
 *   - supplier code inactive                      -> ERROR
 *   - supplier code unknown                       -> supplierCreate (created at import)
 *   - no product with that reference              -> NEW (creation fields required, else ERROR)
 *   - product exists, every compared field same   -> EXISTING_UNCHANGED
 *   - product exists, something differs           -> EXISTING_UPDATE (+changes)
 * Only the fields the file carries are compared. Stock is compared only when
 * `applyStock` (default true for this pure function; the import routes pass the
 * user's explicit choice).
 *   - Qped >= Qgros (file values, or a file value against the stored one) -> ERROR
 */
export function classifyPreloadedRows(
  rows: ProductImportRow[],
  preload: ProductImportPreload,
  options: { applyStock?: boolean } = {},
): { rows: ClassifiedProductRow[]; summary: ProductImportSummary } {
  const applyStock = options.applyStock ?? true;
  const productByRef = new Map(preload.products.map((product) => [product.reference, product]));
  const supplierByCode = new Map(preload.suppliers.map((supplier) => [supplier.code, supplier]));
  const categoryByKey = new Map(
    preload.categories.map((category) => [normalizeCategoryKey(category.name), category]),
  );
  const brandByKey = new Map((preload.brands ?? []).map((brand) => [normalizeCategoryKey(brand.name), brand]));
  const barcodeOwners = preload.barcodeOwners ?? new Map<string, string>();
  const stockByProduct = preload.stockByProduct;

  const referenceCounts = new Map<string, number>();
  const barcodeCounts = new Map<string, number>();
  for (const row of rows) {
    referenceCounts.set(row.reference, (referenceCounts.get(row.reference) ?? 0) + 1);
    if (row.barcode !== undefined) barcodeCounts.set(row.barcode, (barcodeCounts.get(row.barcode) ?? 0) + 1);
  }

  const classified: ClassifiedProductRow[] = rows.map((row) => {
    const existing = productByRef.get(row.reference);
    // The VAT used to turn the file's TTC prices into HT: the file's, else the stored one.
    const rate = row.taxRate ?? existing?.taxRate;
    const ht = (ttc: number | undefined) => (ttc !== undefined && rate !== undefined ? computePriceHTFromTTC(ttc, rate) : undefined);
    const supplier = row.supplierCode !== undefined ? (supplierByCode.get(row.supplierCode) ?? null) : null;
    const category = row.categoryName !== undefined ? (categoryByKey.get(normalizeCategoryKey(row.categoryName)) ?? null) : null;
    const brand = row.brandName !== undefined ? (brandByKey.get(normalizeCategoryKey(row.brandName)) ?? null) : null;

    const base = {
      ...row,
      purchasePriceHT: ht(row.purchasePriceTTC),
      salePriceHT: ht(row.salePriceTTC),
      retailPriceHT: ht(row.retailPriceTTC),
      semiWholesalePriceHT: ht(row.semiWholesalePriceTTC),
      supplierId: supplier?.id ?? null,
      resolvedSupplierName: supplier?.name ?? null,
      supplierCreate: row.supplierCode !== undefined && !supplier,
      categoryId: category?.id ?? null,
      categoryCreate: row.categoryName !== undefined && !category,
      brandId: brand?.id ?? null,
      brandCreate: row.brandName !== undefined && !brand,
      currentStock: null as number | null,
      pendingStock: null as ProductImportChange | null,
      existingId: null as string | null,
      changes: {} as Record<string, ProductImportChange>,
    };
    // never carry an undefined key for an absent price (keeps "absent" = absent)
    for (const key of ["purchasePriceHT", "salePriceHT", "retailPriceHT", "semiWholesalePriceHT"] as const) {
      if (base[key] === undefined) delete base[key];
    }

    if ((referenceCounts.get(row.reference) ?? 0) > 1) {
      return { ...base, status: "CONFLICT", message: "Référence en double dans le fichier." };
    }
    if (row.barcode !== undefined) {
      if ((barcodeCounts.get(row.barcode) ?? 0) > 1) {
        return { ...base, status: "CONFLICT", message: `Code-barres ${row.barcode} en double dans le fichier.` };
      }
      const owner = barcodeOwners.get(row.barcode);
      if (owner && owner !== row.reference) {
        return { ...base, status: "CONFLICT", message: `Code-barres ${row.barcode} déjà utilisé par le produit ${owner}.` };
      }
    }
    // An unknown supplier code is not an error: the import creates that supplier.
    // An existing but INACTIVE supplier is still refused, exactly as before.
    if (supplier && !supplier.active) {
      return { ...base, status: "ERROR", message: `Fournisseur inactif : ${row.supplierCode}` };
    }

    // The thresholds the product will really have: the file's, else the stored
    // ones - Qped must stay below Qgros so the quantity rule is never ambiguous.
    const thresholdsError = tierThresholdsError(
      row.semiWholesaleMinQty ?? existing?.semiWholesaleMinQty ?? null,
      row.wholesaleMinQty ?? existing?.wholesaleMinQty ?? null,
    );
    if (thresholdsError) {
      return { ...base, status: "ERROR", message: thresholdsError };
    }
    if (!existing) {
      const missing = missingCreationFields(row);
      if (missing.length) {
        return {
          ...base,
          status: "ERROR",
          message: `Produit absent de cette organisation : colonne(s) nécessaire(s) à sa création manquante(s) - ${missing.join(", ")}.`,
        };
      }
      const stockToApply = applyStock && row.targetStock !== undefined ? row.targetStock : undefined;
      return {
        ...base,
        ...(stockToApply !== undefined ? { stockToApply } : {}),
        pendingStock: !applyStock && row.targetStock !== undefined && row.targetStock !== 0 ? { old: null, new: row.targetStock.toString() } : null,
        status: "NEW",
        message: "Nouveau produit.",
      };
    }

    const currentStock = stockByProduct.get(existing.id) ?? 0;
    const changes: Record<string, ProductImportChange> = {};
    const text = (key: string, stored: string | null | undefined, next: string | undefined) => {
      if (next !== undefined && (stored ?? null) !== next) changes[key] = { old: stored ?? null, new: next };
    };

    text("name", existing.name, row.name);
    if (row.supplierCode !== undefined && (!supplier || existing.defaultSupplierId !== supplier.id)) {
      changes.supplier = { old: existing.defaultSupplierName ?? null, new: supplier?.name ?? row.supplierName ?? row.supplierCode };
    }
    if (row.categoryName !== undefined && !(category && category.id === existing.categoryId)) {
      changes.category = { old: existing.categoryName ?? null, new: row.categoryName };
    }
    if (row.brandName !== undefined && !(brand && brand.id === (existing.brandId ?? null))) {
      changes.brand = { old: existing.brandName ?? null, new: row.brandName };
    }
    const moneyChange = (key: string, stored: number | null | undefined, next: number | undefined) => {
      if (next !== undefined && (stored == null || money2(stored) !== money2(next))) {
        changes[key] = { old: stored == null ? null : money2(stored).toString(), new: money2(next).toString() };
      }
    };
    moneyChange("purchasePriceHT", existing.purchasePrice, base.purchasePriceHT);
    moneyChange("salePriceHT", existing.salePrice, base.salePriceHT);
    if (row.taxRate !== undefined && money2(existing.taxRate) !== money2(row.taxRate)) {
      changes.taxRate = { old: existing.taxRate.toString(), new: row.taxRate.toString() };
    }
    moneyChange("retailPriceHT", existing.retailPrice, base.retailPriceHT);
    moneyChange("semiWholesalePriceHT", existing.semiWholesalePrice, base.semiWholesalePriceHT);
    for (const field of ["semiWholesaleMinQty", "wholesaleMinQty"] as const) {
      const next = row[field];
      const stored = existing[field] ?? null;
      if (next !== undefined && stored !== next) {
        changes[field] = { old: stored == null ? null : stored.toString(), new: next.toString() };
      }
    }
    if (row.unit !== undefined && row.unit !== (existing.unit ?? "unité")) {
      changes.unit = { old: existing.unit ?? null, new: row.unit };
    }
    text("barcode", existing.barcode, row.barcode);
    text("description", existing.description, row.description);
    if (row.minimumStock !== undefined && row.minimumStock !== (existing.minimumStock ?? 0)) {
      changes.minimumStock = { old: String(existing.minimumStock ?? 0), new: row.minimumStock.toString() };
    }
    text("status", existing.status, row.productStatus);
    if (row.imageUrl !== undefined && row.imageUrl !== (existing.imageUrl ?? null)) {
      changes.photo = { old: existing.imageUrl ? "photo actuelle" : null, new: row.imageUrl };
    }

    let pendingStock: ProductImportChange | null = null;
    let stockToApply: number | undefined;
    if (row.targetStock !== undefined && currentStock !== row.targetStock) {
      const change = { old: currentStock.toString(), new: row.targetStock.toString() };
      if (applyStock) {
        changes.stock = change;
        stockToApply = row.targetStock;
      } else {
        pendingStock = change;
      }
    }

    const hasChanges = Object.keys(changes).length > 0;
    return {
      ...base,
      currentStock,
      ...(stockToApply !== undefined ? { stockToApply } : {}),
      pendingStock,
      existingId: existing.id,
      changes,
      status: hasChanges ? "EXISTING_UPDATE" : "EXISTING_UNCHANGED",
      message: hasChanges ? "Mise à jour détectée." : "Produit inchangé.",
    };
  });

  const count = (status: ProductImportStatus) =>
    classified.filter((row) => row.status === status).length;

  return {
    rows: classified,
    summary: {
      total: classified.length,
      new: count("NEW"),
      unchanged: count("EXISTING_UNCHANGED"),
      update: count("EXISTING_UPDATE"),
      conflicts: count("CONFLICT"),
      errors: count("ERROR"),
    },
  };
}
