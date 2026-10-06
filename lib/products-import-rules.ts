import { z } from "zod";

import { MONEY_RANGE_MAX_NUMBER, roundMoney } from "@/lib/money";
import { computePriceHTFromTTC } from "@/lib/product-pricing";
import {
  PRODUCT_IMPORT_BATCH_MAX_ROWS,
  PRODUCT_IMPORT_MAX_ROWS,
  importBatchLimitMessage,
  importRowLimitMessage,
} from "@/lib/products-import-shared";

/**
 * The business rules of the products Excel import (feuille "produits"), with no
 * database and no "server-only": the row contract and the pure comparison of a
 * file line against what is already stored. lib/server/products-import.ts
 * preloads the stored data (one grouped query per table) and calls
 * classifyPreloadedRows; both endpoints (preview and batch write) go through it,
 * so they can never drift apart.
 *
 * Moved here VERBATIM from lib/server/products-import.ts so it can be unit
 * tested - the rules themselves are unchanged.
 */

export const productImportRowSchema = z.object({
  excelRow: z.number().int().positive(),
  reference: z.string().trim().min(1),
  supplierCode: z.string().trim().min(1),
  name: z.string().trim().min(1),
  categoryName: z.string().trim().min(1),
  // Prices are the tax-INCLUDED values from the file; HT is derived below.
  purchasePriceTTC: z.number().finite().min(0).max(MONEY_RANGE_MAX_NUMBER),
  salePriceTTC: z.number().finite().min(0).max(MONEY_RANGE_MAX_NUMBER),
  // Percentage, never a fraction: 20 = 20 %.
  taxRate: z.number().finite().min(0).max(100),
  // Target stock in the depot. Integer, MAY be negative (§12).
  targetStock: z.number().int(),
});

/** The whole file, for the read-only preview (global conflict detection). */
export const productImportSchema = z.object({
  rows: z.array(productImportRowSchema).max(PRODUCT_IMPORT_MAX_ROWS),
});

/** One batch of the real write: a few hundred lines, never the whole file. */
export const productImportBatchSchema = z.object({
  rows: z.array(productImportRowSchema).max(PRODUCT_IMPORT_BATCH_MAX_ROWS),
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
  /** Derived tax-excluded prices, stored as-is on Product (same convention
   * as the product form + /achats: computePriceHTFromTTC). */
  purchasePriceHT: number;
  salePriceHT: number;
  supplierId: string | null;
  supplierName: string | null;
  /** Resolved existing category id, or null when it will be created. */
  categoryId: string | null;
  categoryCreate: boolean;
  /** Depot stock today; null for a brand-new product. */
  currentStock: number | null;
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
  }[];
  suppliers: { id: string; code: string; name: string; active: boolean }[];
  categories: { id: string; name: string }[];
  /** Depot stock per existing product id. */
  stockByProduct: Map<string, number>;
};

const money2 = (value: number) => roundMoney(value);

/**
 * A pure in-memory compare (no database, no N+1):
 *   - reference used twice in the file          -> CONFLICT (both rows)
 *   - supplier code unknown / inactive          -> ERROR
 *   - no product with that reference            -> NEW
 *   - product exists, every compared field same -> EXISTING_UNCHANGED
 *   - product exists, something differs         -> EXISTING_UPDATE (+changes)
 * Compared fields for UPDATE: name, supplier, category, purchasePrice HT,
 * salePrice HT, taxRate, target stock (§9).
 */
export function classifyPreloadedRows(
  rows: ProductImportRow[],
  preload: ProductImportPreload,
): { rows: ClassifiedProductRow[]; summary: ProductImportSummary } {
  const productByRef = new Map(preload.products.map((product) => [product.reference, product]));
  const supplierByCode = new Map(preload.suppliers.map((supplier) => [supplier.code, supplier]));
  const categoryByKey = new Map(
    preload.categories.map((category) => [normalizeCategoryKey(category.name), category]),
  );
  const stockByProduct = preload.stockByProduct;

  const referenceCounts = new Map<string, number>();
  for (const row of rows) {
    referenceCounts.set(row.reference, (referenceCounts.get(row.reference) ?? 0) + 1);
  }

  const classified: ClassifiedProductRow[] = rows.map((row) => {
    const purchasePriceHT = computePriceHTFromTTC(row.purchasePriceTTC, row.taxRate);
    const salePriceHT = computePriceHTFromTTC(row.salePriceTTC, row.taxRate);
    const supplier = supplierByCode.get(row.supplierCode) ?? null;
    const category = categoryByKey.get(normalizeCategoryKey(row.categoryName)) ?? null;

    const base = {
      ...row,
      purchasePriceHT,
      salePriceHT,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? null,
      categoryId: category?.id ?? null,
      categoryCreate: !category,
      currentStock: null as number | null,
      existingId: null as string | null,
      changes: {} as Record<string, ProductImportChange>,
    };

    if ((referenceCounts.get(row.reference) ?? 0) > 1) {
      return { ...base, status: "CONFLICT", message: "Référence en double dans le fichier." };
    }
    if (!supplier) {
      return { ...base, status: "ERROR", message: `Fournisseur introuvable : ${row.supplierCode}` };
    }
    if (!supplier.active) {
      return { ...base, status: "ERROR", message: `Fournisseur inactif : ${row.supplierCode}` };
    }

    const existing = productByRef.get(row.reference);
    if (!existing) {
      return { ...base, status: "NEW", message: "Nouveau produit." };
    }

    const currentStock = stockByProduct.get(existing.id) ?? 0;
    const changes: Record<string, ProductImportChange> = {};

    if (existing.name !== row.name) {
      changes.name = { old: existing.name, new: row.name };
    }
    if (existing.defaultSupplierId !== supplier.id) {
      changes.supplier = { old: existing.defaultSupplierName ?? null, new: supplier.name };
    }
    const sameCategory = category ? category.id === existing.categoryId : false;
    if (!sameCategory) {
      changes.category = { old: existing.categoryName ?? null, new: row.categoryName };
    }
    if (money2(existing.purchasePrice) !== money2(purchasePriceHT)) {
      changes.purchasePriceHT = {
        old: money2(existing.purchasePrice).toString(),
        new: money2(purchasePriceHT).toString(),
      };
    }
    if (money2(existing.salePrice) !== money2(salePriceHT)) {
      changes.salePriceHT = {
        old: money2(existing.salePrice).toString(),
        new: money2(salePriceHT).toString(),
      };
    }
    if (money2(existing.taxRate) !== money2(row.taxRate)) {
      changes.taxRate = {
        old: existing.taxRate.toString(),
        new: row.taxRate.toString(),
      };
    }
    if (currentStock !== row.targetStock) {
      changes.stock = { old: currentStock.toString(), new: row.targetStock.toString() };
    }

    const hasChanges = Object.keys(changes).length > 0;
    return {
      ...base,
      currentStock,
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
