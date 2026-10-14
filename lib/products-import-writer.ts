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
  /** Variants groups written in ONE committed transaction each. */
  groupsWritten: number;
  /** Groups whose transaction failed: nothing of them was written. */
  groupsRolledBack: number;
  /** Groups refused before any transaction (a blocked group, an incomplete one, a missing supplier...). */
  groupsRefused: number;
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
  /** Stock as a TARGET; returns true when stock moved (a movement is, or - in a group - will be, recorded). */
  syncStock(productId: string, targetStock: number): Promise<boolean>;
  /**
   * Group transactions only: records, in ONE step and at the very end of the group's work, the movements
   * syncStock announced (so the movement counter is locked briefly, not for the whole group).
   */
  commitMovements?(): Promise<void>;
};

export type ImportWriteStore = {
  /** Runs `work` in ONE transaction: everything it wrote commits, or nothing does. */
  runLine<T>(work: (tx: ImportLineTx) => Promise<T>): Promise<T>;
  /**
   * Runs `work` - ALL the lines of one variants group - in ONE transaction: the whole
   * group commits, or nothing of it does. `work` may be run again from scratch if the
   * database asks for a retry, so it must not keep anything outside the transaction.
   * A store without it cannot write groups: they are refused, never written line by line.
   */
  runGroup?<T>(work: (tx: ImportLineTx) => Promise<T>): Promise<T>;
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
  // only after a transaction actually commits - a rolled-back line or group leaves them as they were.
  const created: CreatedIds = { categories: new Map(), suppliers: new Map(), brands: new Map() };
  let categoriesCreated = 0;
  let suppliersCreated = 0;
  let brandsCreated = 0;
  let stockMovementsCreated = 0;
  const groups = { written: 0, rolledBack: 0, refused: 0 };

  // A variants group is ONE unit of work (never split, never interleaved); every other line is its own.
  const { results: unitOutcomes, deferred } = await processUntilBudget(
    workUnits(rows),
    async (unit): Promise<RowOutcome[]> => {
      if (unit.kind === "line") return [await applyRow(store, unit.row, created)];
      const outcome = await applyGroup(store, unit.rows, created);
      groups[outcome.fate] += 1;
      return outcome.outcomes;
    },
    { budgetMs: options.budgetMs ?? PRODUCT_IMPORT_BATCH_TIME_BUDGET_MS, now: options.now },
  );
  const outcomes = unitOutcomes.flat();

  for (const outcome of outcomes) {
    categoriesCreated += outcome.categoryCreated ? 1 : 0;
    suppliersCreated += outcome.supplierCreated ? 1 : 0;
    brandsCreated += outcome.brandCreated ? 1 : 0;
    stockMovementsCreated += outcome.stockMovementCreated ? 1 : 0;
  }

  return {
    results: outcomes.map((outcome) => outcome.result),
    // WHOLE groups are handed back, never some of their lines.
    deferred: deferred.flatMap((unit) => (unit.kind === "line" ? [unit.row.excelRow] : unit.rows.map((row) => row.excelRow))),
    categoriesCreated,
    suppliersCreated,
    brandsCreated,
    stockMovementsCreated,
    groupsWritten: groups.written,
    groupsRolledBack: groups.rolledBack,
    groupsRefused: groups.refused,
  };
}

type CreatedIds = {
  categories: Map<string, string>;
  suppliers: Map<string, string>;
  brands: Map<string, string>;
};

type WorkUnit = { kind: "line"; row: ClassifiedProductRow } | { kind: "group"; rows: ClassifiedProductRow[] };

/**
 * The batch as units of work, in order of first appearance: every line of a variants
 * group (same variantGroupIndex, set by the classification) joins its group, any other
 * line is a unit of its own - so a file without variants is processed exactly line by line.
 */
function workUnits(rows: readonly ClassifiedProductRow[]): WorkUnit[] {
  const units: WorkUnit[] = [];
  const groups = new Map<number, Extract<WorkUnit, { kind: "group" }>>();
  for (const row of rows) {
    if (row.variantGroupIndex === undefined) {
      units.push({ kind: "line", row });
      continue;
    }
    let group = groups.get(row.variantGroupIndex);
    if (!group) {
      group = { kind: "group", rows: [] };
      groups.set(row.variantGroupIndex, group);
      units.push(group);
    }
    group.rows.push(row);
  }
  return units;
}

const rowMeta = (row: ClassifiedProductRow) => ({ excelRow: row.excelRow, reference: row.reference, name: row.name ?? row.reference });
const IDLE = { categoryCreated: false, supplierCreated: false, brandCreated: false, stockMovementCreated: false };

/** What a line cannot be written for, checked BEFORE any transaction (null = it can be). */
function refusalBeforeWrite(row: ClassifiedProductRow): string | null {
  if (row.supplierCode !== undefined && !row.supplierId && !row.supplierCreate) return `Fournisseur introuvable : ${row.supplierCode}`;
  if (row.status === "NEW" && (row.supplierCode === undefined || row.categoryName === undefined)) {
    return "Fournisseur et catégorie obligatoires pour créer un produit.";
  }
  if (row.status === "EXISTING_UPDATE" && !row.existingId) return "Produit introuvable au moment de la mise à jour.";
  return null;
}

type AppliedRow = {
  category: { id: string; created: boolean } | null;
  supplier: { id: string; created: boolean } | null;
  brand: { id: string; created: boolean } | null;
  stockMovementCreated: boolean;
};

/**
 * The database work of ONE importable line, inside the caller's transaction: supplier,
 * category and brand (the known ids first, else re-checked and created), the product,
 * then the stock target. Shared by the single-line and the group paths.
 */
async function writeRowInTx(tx: ImportLineTx, row: ClassifiedProductRow, known: CreatedIds): Promise<AppliedRow> {
  const categoryKey = row.categoryName !== undefined ? normalizeCategoryKey(row.categoryName) : null;
  const brandKey = row.brandName !== undefined ? normalizeCategoryKey(row.brandName) : null;

  const supplier =
    row.supplierCode !== undefined ? await resolveSupplier(tx, row, known.suppliers.get(row.supplierCode) ?? row.supplierId) : null;
  const category = categoryKey !== null ? await resolveCategory(tx, row, known.categories.get(categoryKey) ?? row.categoryId) : null;
  const brand = brandKey !== null ? await resolveBrand(tx, row, known.brands.get(brandKey) ?? row.brandId) : null;

  const productId =
    row.status === "NEW"
      ? await tx.createProduct(row, category!.id, supplier!.id, brand?.id ?? null)
      : await tx.updateProduct(row.existingId!, row, category?.id ?? null, supplier?.id ?? null, brand?.id ?? null);

  // Stock only when the classification decided to apply it (the user confirmed it).
  const stockMovementCreated = row.stockToApply !== undefined ? await tx.syncStock(productId, row.stockToApply) : false;

  return { category, supplier, brand, stockMovementCreated };
}

/** The new supplier / category / brand of a line that is now (or, in a group, will be if it commits) visible to the next lines. */
function rememberCreated(known: CreatedIds, row: ClassifiedProductRow, applied: AppliedRow): void {
  if (applied.category?.created && row.categoryName !== undefined) known.categories.set(normalizeCategoryKey(row.categoryName), applied.category.id);
  if (applied.supplier?.created && row.supplierCode !== undefined) known.suppliers.set(row.supplierCode, applied.supplier.id);
  if (applied.brand?.created && row.brandName !== undefined) known.brands.set(normalizeCategoryKey(row.brandName), applied.brand.id);
}

async function applyRow(store: ImportWriteStore, row: ClassifiedProductRow, created: CreatedIds): Promise<RowOutcome> {
  const meta = rowMeta(row);
  const idle = IDLE;

  if (row.status === "CONFLICT") {
    return { result: { ...meta, status: "CONFLICT", message: row.message }, ...idle };
  }
  if (row.status === "ERROR") {
    return { result: { ...meta, status: "ERROR", message: row.message }, ...idle };
  }
  if (row.status === "EXISTING_UNCHANGED") {
    return { result: { ...meta, status: "UNCHANGED", message: "Produit inchangé." }, ...idle };
  }
  const refusal = refusalBeforeWrite(row);
  if (refusal) return { result: { ...meta, status: "ERROR", message: refusal }, ...idle };

  try {
    const applied = await store.runLine((tx) => writeRowInTx(tx, row, created));

    // The line committed: its new supplier / category / brand now exist for the next lines.
    const categoryKey = row.categoryName !== undefined ? normalizeCategoryKey(row.categoryName) : null;
    const brandKey = row.brandName !== undefined ? normalizeCategoryKey(row.brandName) : null;
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

/** A line of a group failed inside the group's transaction (which is rolled back as a whole). */
class GroupRowFailure extends Error {
  constructor(
    readonly row: ClassifiedProductRow,
    readonly cause: unknown,
  ) {
    super("group line failed");
    this.name = "GroupRowFailure";
  }
}

const isProblemStatus = (status: ClassifiedProductRow["status"]) => status === "ERROR" || status === "CONFLICT";

/**
 * Database errors about the TRANSACTION, not about the line that happened to be running:
 * a serialization failure (the store retries the whole group on it, so it must reach the
 * store untouched), a transaction that outlived its time, a connection that could not be
 * obtained. They are never blamed on a line.
 */
function transactionLevelReason(error: unknown): string | null {
  const { code, message } = error as { code?: string; message?: string };
  if (code === "P2034" || (code === "P2010" && /40001|40P01/.test(message ?? ""))) return "conflit d'accès concurrent, nouvelle tentative impossible";
  if (code === "P2028") return "la transaction a dépassé son délai";
  if (code === "P2024") return "aucune connexion disponible à temps";
  return null;
}

/**
 * The write of ONE variants group, all or nothing:
 *   - a group with any line in error / conflict (or blocked) is refused outright: no
 *     transaction is opened, every line says why;
 *   - otherwise all its NEW / updated lines are written in ONE transaction (store.runGroup),
 *     the unchanged ones need no write;
 *   - if any line fails the whole transaction is rolled back: the failing line reports its
 *     own error, the others "Groupe annulé"; nothing created inside (product, stock,
 *     movement, supplier, category, brand) survives, and neither the caches nor the
 *     counters keep any trace of it - they are only updated once the transaction committed.
 */
async function applyGroup(
  store: ImportWriteStore,
  rows: ClassifiedProductRow[],
  created: CreatedIds,
): Promise<{ outcomes: RowOutcome[]; fate: "written" | "rolledBack" | "refused" }> {
  const refusedAll = (message: (row: ClassifiedProductRow) => string, status: "ERROR" | "CONFLICT" = "ERROR") => ({
    outcomes: rows.map((row): RowOutcome => ({ result: { ...rowMeta(row), status, message: message(row) }, ...IDLE })),
    fate: "refused" as const,
  });

  // 1. A group with a line of its own in problem is never written - not one line of it.
  const problem = rows.find((row) => isProblemStatus(row.status));
  if (problem) {
    return {
      outcomes: rows.map((row): RowOutcome => {
        if (isProblemStatus(row.status)) return { result: { ...rowMeta(row), status: row.status as "ERROR" | "CONFLICT", message: row.message }, ...IDLE };
        return {
          result: { ...rowMeta(row), status: "ERROR", message: `Groupe bloqué : la ligne ${problem.excelRow} est en erreur - aucune variante du groupe n'est écrite.` },
          ...IDLE,
        };
      }),
      fate: "refused",
    };
  }

  // 2. What cannot be written is found out before the transaction.
  const writable = rows.filter((row) => row.status === "NEW" || row.status === "EXISTING_UPDATE");
  const refusal = writable.map((row) => ({ row, message: refusalBeforeWrite(row) })).find((entry) => entry.message !== null);
  if (refusal) {
    return {
      outcomes: rows.map((row): RowOutcome => ({
        result: {
          ...rowMeta(row),
          status: "ERROR",
          message: row === refusal.row ? refusal.message! : `Groupe refusé : la ligne ${refusal.row.excelRow} ne peut pas être écrite - aucune variante du groupe n'est écrite.`,
        },
        ...IDLE,
      })),
      fate: "refused",
    };
  }

  // 3. Only unchanged lines: nothing to write, no transaction.
  const unchangedOutcome = (row: ClassifiedProductRow): RowOutcome => ({ result: { ...rowMeta(row), status: "UNCHANGED", message: "Produit inchangé." }, ...IDLE });
  if (writable.length === 0) return { outcomes: rows.map(unchangedOutcome), fate: "written" };

  if (!store.runGroup) {
    return refusedAll(() => "Écriture atomique par groupe indisponible : aucune variante du groupe n'est écrite.");
  }

  // 4. ONE transaction for the whole group.
  try {
    const committed = await store.runGroup(async (tx) => {
      // Rebuilt on every attempt: a retried transaction starts from the batch-level caches again.
      const local: CreatedIds = {
        categories: new Map(created.categories),
        suppliers: new Map(created.suppliers),
        brands: new Map(created.brands),
      };
      const applied = new Map<ClassifiedProductRow, AppliedRow>();
      for (const row of writable) {
        try {
          const done = await writeRowInTx(tx, row, local);
          applied.set(row, done);
          rememberCreated(local, row, done); // visible to the next lines of THIS transaction only
        } catch (error) {
          // A transaction-level error goes up as it is (the store may retry the group); a line's own error is wrapped.
          throw transactionLevelReason(error) !== null ? error : new GroupRowFailure(row, error);
        }
      }
      // Last statement of the transaction: the movements of the whole group, numbered in one step.
      await tx.commitMovements?.();
      return { applied, local };
    });

    // The transaction committed: only now do the batch caches learn what it created.
    for (const [key, id] of committed.local.categories) created.categories.set(key, id);
    for (const [key, id] of committed.local.suppliers) created.suppliers.set(key, id);
    for (const [key, id] of committed.local.brands) created.brands.set(key, id);

    return {
      outcomes: rows.map((row): RowOutcome => {
        const applied = committed.applied.get(row);
        if (!applied) return unchangedOutcome(row);
        return {
          result: {
            ...rowMeta(row),
            status: row.status === "NEW" ? "CREATED" : "UPDATED",
            message: row.status === "NEW" ? "Produit créé." : "Produit mis à jour.",
          },
          categoryCreated: applied.category?.created ?? false,
          supplierCreated: applied.supplier?.created ?? false,
          brandCreated: applied.brand?.created ?? false,
          stockMovementCreated: applied.stockMovementCreated,
        };
      }),
      fate: "written",
    };
  } catch (error) {
    // Rolled back: nothing was written, no cache and no counter was touched.
    const failure = error instanceof GroupRowFailure ? error : null;
    const reason = failure ? null : (transactionLevelReason(error) ?? store.describeError(error)?.message ?? "erreur de base de données");
    return {
      outcomes: rows.map((row): RowOutcome => {
        if (!writable.includes(row)) return unchangedOutcome(row);
        if (failure && row === failure.row) return { result: mapGroupRowError(store, rowMeta(row), failure.cause), ...IDLE };
        return {
          result: {
            ...rowMeta(row),
            status: "ERROR",
            message: failure
              ? `Groupe annulé : la ligne ${failure.row.excelRow} a échoué - aucune variante du groupe n'a été écrite.`
              : `Groupe annulé (${reason}) - aucune variante du groupe n'a été écrite.`,
          },
          ...IDLE,
        };
      }),
      fate: "rolledBack",
    };
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

/**
 * Where a unique violation happened, as text. With the PostgreSQL driver adapter Prisma gives no meta.target:
 * the name of the violated constraint (Product_organizationId_barcode_key, Product_variant_identity_key...) is
 * only in the driver error - searched by its NAME, which does not depend on the database server language.
 */
function uniqueViolationText(error: unknown): string {
  // (never the error MESSAGE: Prisma prints the failed call in it, whose field names would match any constraint)
  const { meta } = error as {
    meta?: { target?: string[] | string; driverAdapterError?: { cause?: { originalMessage?: string; constraint?: string } } };
  };
  const cause = meta?.driverAdapterError?.cause;
  return [Array.isArray(meta?.target) ? meta.target.join(",") : (meta?.target ?? ""), cause?.constraint ?? "", cause?.originalMessage ?? ""].join(" ");
}

/**
 * Why a line of a GROUP failed. A uniqueness error on the reference is NOT "already present"
 * here (that answer is right for a lone line): inside a group it means another import has
 * just written part of it, so the group was rolled back and must be previewed again.
 */
function mapGroupRowError(
  store: ImportWriteStore,
  meta: Omit<ImportRowResult, "status" | "message">,
  error: unknown,
): ImportRowResult {
  const prismaError = error as { code?: string };
  if (prismaError.code === "P2002") {
    const target = uniqueViolationText(error);
    if (target.includes("barcode")) return { ...meta, status: "CONFLICT", message: "Code-barres déjà utilisé par un autre produit." };
    if (target.includes("variant")) return { ...meta, status: "CONFLICT", message: "Cette combinaison de variante existe déjà pour ce produit parent." };
    if (target.includes("reference")) {
      return { ...meta, status: "CONFLICT", message: "Référence déjà présente : un autre import a peut-être écrit une partie de ce groupe - relancez l'aperçu." };
    }
    return { ...meta, status: "CONFLICT", message: "Conflit d'unicité sur cette ligne." };
  }
  return mapRowError(store, meta, error);
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
