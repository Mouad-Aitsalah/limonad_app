import { normalizeCategoryKey, type ClassifiedProductRow } from "@/lib/products-import-rules";
import { PRODUCT_IMPORT_BATCH_TIME_BUDGET_MS, processUntilBudget } from "@/lib/products-import-shared";

/**
 * The real write of the products import for ONE batch of already classified lines,
 * written against a small storage interface (ImportWriteStore) instead of Prisma, so
 * the whole behaviour - line by line, error isolation, supplier / category / brand
 * creation once per batch - is unit tested without a database. The Prisma
 * implementation of the store (organisation scoping, the actual queries) is
 * lib/server/products-import-store.ts, run by lib/server/products-import-apply.ts
 * (Serializable transaction + retry).
 *
 * The per-line rules are the ones the import always had: each importable line is
 * applied in its OWN transaction - Supplier / Category / Brand (created on the fly) +
 * Product + StockLevel + StockMovement commit or roll back together (§15). A failing
 * line is reported as ERROR/CONFLICT without rolling back the lines already done
 * (§10). Stock is a TARGET, not an addition (§14, idempotent), written only when the
 * classification set `stockToApply` (the user confirmed "apply the stock"). Lines are
 * applied one after the other and, past the time budget, the lines not yet started
 * are handed back as `deferred`.
 *
 * Only what the line carries is written: a column absent from the file (or an empty
 * cell) leaves the stored value - and the stored supplier / category / brand link -
 * untouched.
 *
 * Suppliers: a line whose ref_fournisseur matches no supplier of the organisation
 * creates it (code = ref_fournisseur, name = nom_fournisseur when the file has it,
 * else the code) inside the line's transaction, after a re-check (it may have been
 * created since the classification). The id of a supplier / category / brand created
 * by a COMMITTED line is reused by the next lines of the batch, so ten lines with the
 * same new code create exactly one; the next batch (and a second import of the same
 * file) finds it in its own classification and simply reuses it.
 */

export type ImportRowStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "ERROR";

export type ImportRowResult = {
  excelRow: number;
  reference: string;
  name: string;
  status: ImportRowStatus;
  message: string;
};

export type ProductImportBatchOutcome = {
  results: ImportRowResult[];
  /** Excel line numbers the server did not start (time budget spent). */
  deferred: number[];
  categoriesCreated: number;
  suppliersCreated: number;
  brandsCreated: number;
  stockMovementsCreated: number;
};

/** The database work of ONE line, inside its transaction. Every call is scoped to the
 * caller's organisation by the implementation - never by a value of the file. */
export type ImportLineTx = {
  /** The supplier with exactly this code in the organisation, if any. */
  findSupplierByCode(code: string): Promise<{ id: string; active: boolean } | null>;
  createSupplier(input: { code: string; name: string }): Promise<{ id: string }>;
  /** Case-insensitive, on the trimmed name ("JUS" reuses "Jus"). */
  findCategoryByName(name: string): Promise<{ id: string } | null>;
  createCategory(name: string): Promise<{ id: string }>;
  /** Case-insensitive, on the trimmed name. */
  findBrandByName(name: string): Promise<{ id: string } | null>;
  createBrand(name: string): Promise<{ id: string }>;
  createProduct(row: ClassifiedProductRow, categoryId: string, supplierId: string, brandId: string | null): Promise<string>;
  /**
   * Writes ONLY what the line carries: a null category / supplier / brand id means
   * that column is not in the file and the stored link is kept. Throws a business
   * error (status 404) when the product no longer exists.
   */
  updateProduct(
    productId: string,
    row: ClassifiedProductRow,
    categoryId: string | null,
    supplierId: string | null,
    brandId: string | null,
  ): Promise<string>;
  /** Stock as a TARGET; returns true when a movement was written. */
  syncStock(productId: string, targetStock: number): Promise<boolean>;
};

export type ImportWriteStore = {
  /** Runs `work` in ONE transaction: everything it wrote commits, or nothing does. */
  runLine<T>(work: (tx: ImportLineTx) => Promise<T>): Promise<T>;
  /** The application's own business errors ({ status, message }), null for anything else. */
  describeError(error: unknown): { status: number; message: string } | null;
};

type RowOutcome = {
  result: ImportRowResult;
  categoryCreated: boolean;
  supplierCreated: boolean;
  brandCreated: boolean;
  stockMovementCreated: boolean;
};

/** A line-level refusal raised inside the transaction (rolls the line back). */
export class ImportLineError extends Error {
  constructor(
    message: string,
    readonly status: "ERROR" | "CONFLICT" = "ERROR",
  ) {
    super(message);
    this.name = "ImportLineError";
  }
}

export async function writeImportBatch(
  store: ImportWriteStore,
  rows: ClassifiedProductRow[],
  options: { budgetMs?: number; now?: () => number } = {},
): Promise<ProductImportBatchOutcome> {
  // Categories / brands auto-created during this batch keyed by normalizeCategoryKey
  // ("Jus" and "JUS" create exactly one, §4), suppliers by their exact code. Updated
  // only after a line's transaction actually commits.
  const created: CreatedIds = { categories: new Map(), suppliers: new Map(), brands: new Map() };
  let categoriesCreated = 0;
  let suppliersCreated = 0;
  let brandsCreated = 0;
  let stockMovementsCreated = 0;

  const { results: outcomes, deferred } = await processUntilBudget(
    rows,
    (row) => applyRow(store, row, created),
    { budgetMs: options.budgetMs ?? PRODUCT_IMPORT_BATCH_TIME_BUDGET_MS, now: options.now },
  );

  for (const outcome of outcomes) {
    categoriesCreated += outcome.categoryCreated ? 1 : 0;
    suppliersCreated += outcome.supplierCreated ? 1 : 0;
    brandsCreated += outcome.brandCreated ? 1 : 0;
    stockMovementsCreated += outcome.stockMovementCreated ? 1 : 0;
  }

  return {
    results: outcomes.map((outcome) => outcome.result),
    deferred: deferred.map((row) => row.excelRow),
    categoriesCreated,
    suppliersCreated,
    brandsCreated,
    stockMovementsCreated,
  };
}

type CreatedIds = {
  categories: Map<string, string>;
  suppliers: Map<string, string>;
  brands: Map<string, string>;
};

async function applyRow(store: ImportWriteStore, row: ClassifiedProductRow, created: CreatedIds): Promise<RowOutcome> {
  const meta = { excelRow: row.excelRow, reference: row.reference, name: row.name ?? row.reference };
  const idle = { categoryCreated: false, supplierCreated: false, brandCreated: false, stockMovementCreated: false };

  if (row.status === "CONFLICT") {
    return { result: { ...meta, status: "CONFLICT", message: row.message }, ...idle };
  }
  if (row.status === "ERROR") {
    return { result: { ...meta, status: "ERROR", message: row.message }, ...idle };
  }
  if (row.status === "EXISTING_UNCHANGED") {
    return { result: { ...meta, status: "UNCHANGED", message: "Produit inchangé." }, ...idle };
  }
  if (row.supplierCode !== undefined && !row.supplierId && !row.supplierCreate) {
    return { result: { ...meta, status: "ERROR", message: `Fournisseur introuvable : ${row.supplierCode}` }, ...idle };
  }
  if (row.status === "NEW" && (row.supplierCode === undefined || row.categoryName === undefined)) {
    return { result: { ...meta, status: "ERROR", message: "Fournisseur et catégorie obligatoires pour créer un produit." }, ...idle };
  }
  if (row.status === "EXISTING_UPDATE" && !row.existingId) {
    return { result: { ...meta, status: "ERROR", message: "Produit introuvable au moment de la mise à jour." }, ...idle };
  }

  const categoryKey = row.categoryName !== undefined ? normalizeCategoryKey(row.categoryName) : null;
  const brandKey = row.brandName !== undefined ? normalizeCategoryKey(row.brandName) : null;

  try {
    const applied = await store.runLine(async (tx) => {
      const supplier =
        row.supplierCode !== undefined
          ? await resolveSupplier(tx, row, created.suppliers.get(row.supplierCode) ?? row.supplierId)
          : null;
      const category =
        categoryKey !== null ? await resolveCategory(tx, row, created.categories.get(categoryKey) ?? row.categoryId) : null;
      const brand = brandKey !== null ? await resolveBrand(tx, row, created.brands.get(brandKey) ?? row.brandId) : null;

      const productId =
        row.status === "NEW"
          ? await tx.createProduct(row, category!.id, supplier!.id, brand?.id ?? null)
          : await tx.updateProduct(row.existingId!, row, category?.id ?? null, supplier?.id ?? null, brand?.id ?? null);

      // Stock only when the classification decided to apply it (the user confirmed it).
      const stockMovementCreated = row.stockToApply !== undefined ? await tx.syncStock(productId, row.stockToApply) : false;

      return {
        category,
        supplier,
        brand,
        stockMovementCreated,
      };
    });

    // The line committed: its new supplier / category / brand now exist for the next lines.
    if (applied.category?.created && categoryKey !== null) created.categories.set(categoryKey, applied.category.id);
    if (applied.supplier?.created && row.supplierCode !== undefined) created.suppliers.set(row.supplierCode, applied.supplier.id);
    if (applied.brand?.created && brandKey !== null) created.brands.set(brandKey, applied.brand.id);

    return {
      result: {
        ...meta,
        status: row.status === "NEW" ? "CREATED" : "UPDATED",
        message: row.status === "NEW" ? "Produit créé." : "Produit mis à jour.",
      },
      categoryCreated: applied.category?.created ?? false,
      supplierCreated: applied.supplier?.created ?? false,
      brandCreated: applied.brand?.created ?? false,
      stockMovementCreated: applied.stockMovementCreated,
    };
  } catch (error) {
    return { result: mapRowError(store, meta, error), ...idle };
  }
}

/**
 * The supplier of the line: the one the classification resolved (or an earlier line
 * of the batch created); otherwise re-checked inside the transaction - it may have
 * been created since the preload - and created only if still absent.
 */
async function resolveSupplier(
  tx: ImportLineTx,
  row: ClassifiedProductRow,
  knownId: string | null,
): Promise<{ id: string; created: boolean }> {
  if (knownId) return { id: knownId, created: false };
  const code = row.supplierCode!;

  const existing = await tx.findSupplierByCode(code);
  if (existing) {
    if (!existing.active) throw new ImportLineError(`Fournisseur inactif : ${code}`);
    return { id: existing.id, created: false };
  }

  // The supplier name of the file (nom_fournisseur) when there is one, else its code.
  const created = await tx.createSupplier({ code, name: row.supplierName ?? code });
  return { id: created.id, created: true };
}

async function resolveCategory(
  tx: ImportLineTx,
  row: ClassifiedProductRow,
  knownId: string | null,
): Promise<{ id: string; created: boolean }> {
  if (knownId) return { id: knownId, created: false };

  // Re-check inside the transaction: a category with this name may exist now
  // (created since the preload, or by an earlier line). Case-insensitive so
  // "JUS" reuses an existing "Jus".
  const name = row.categoryName!.trim();
  const existing = await tx.findCategoryByName(name);
  if (existing) return { id: existing.id, created: false };

  const created = await tx.createCategory(name);
  return { id: created.id, created: true };
}

/** Same pattern as the category: re-checked inside the transaction, created once. */
async function resolveBrand(
  tx: ImportLineTx,
  row: ClassifiedProductRow,
  knownId: string | null,
): Promise<{ id: string; created: boolean }> {
  if (knownId) return { id: knownId, created: false };
  const name = row.brandName!.trim();
  const existing = await tx.findBrandByName(name);
  if (existing) return { id: existing.id, created: false };
  const created = await tx.createBrand(name);
  return { id: created.id, created: true };
}

function mapRowError(
  store: ImportWriteStore,
  meta: Omit<ImportRowResult, "status" | "message">,
  error: unknown,
): ImportRowResult {
  const prismaError = error as { code?: string; meta?: { target?: string[] | string } };

  if (prismaError.code === "P2002") {
    const target = Array.isArray(prismaError.meta?.target)
      ? prismaError.meta.target.join(",")
      : String(prismaError.meta?.target ?? "");
    if (target.includes("barcode")) {
      return { ...meta, status: "CONFLICT", message: "Code-barres déjà utilisé par un autre produit." };
    }
    if (target.includes("reference")) {
      return { ...meta, status: "UNCHANGED", message: "Produit déjà présent." };
    }
    return { ...meta, status: "CONFLICT", message: "Conflit d'unicité sur cette ligne." };
  }

  if (error instanceof ImportLineError) {
    return { ...meta, status: error.status, message: error.message };
  }

  const business = store.describeError(error);
  if (business) {
    return {
      ...meta,
      status: business.status === 409 ? "CONFLICT" : "ERROR",
      message: business.message,
    };
  }

  return { ...meta, status: "ERROR", message: "Import impossible pour cette ligne." };
}
