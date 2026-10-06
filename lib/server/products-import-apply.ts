import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normalizeCategoryKey,
  type ClassifiedProductRow,
} from "@/lib/products-import-rules";
import {
  PRODUCT_IMPORT_BATCH_TIME_BUDGET_MS,
  processUntilBudget,
} from "@/lib/products-import-shared";
import { nextCategoryCode } from "@/lib/server/categories";
import { OperationsServiceError } from "@/lib/server/depots";
import { nextMovementNumber } from "@/lib/server/sales-shared";

/**
 * The real write of the products import, for ONE batch of already classified
 * lines. The per-line behaviour (applyRow and everything under it) is the one
 * the import always had, moved here unchanged from app/api/produits/import/
 * route.ts: each importable line is applied in its OWN Serializable
 * transaction - Product (+ a Category created on the fly) + StockLevel +
 * StockMovement commit or roll back together (§15). A failing line is reported
 * as ERROR/CONFLICT without rolling back the lines already done (§10). Stock is
 * a TARGET, not an addition: a re-import of the same file finds delta 0 and
 * writes no extra movement (§14, idempotent).
 *
 * What is new is only the batch frame: lines are applied one after the other
 * (never in parallel) and, past the time budget, the lines not yet started are
 * handed back as `deferred` for the browser to send again, so one request can
 * never be killed half-way by the 60 s limit.
 */

export type ImportRowStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "ERROR";

export type ImportRowResult = {
  excelRow: number;
  reference: string;
  name: string;
  status: ImportRowStatus;
  message: string;
};

type RowOutcome = {
  result: ImportRowResult;
  categoryCreated: boolean;
  stockMovementCreated: boolean;
};

export type ProductImportBatchOutcome = {
  results: ImportRowResult[];
  /** Excel line numbers the server did not start (time budget spent). */
  deferred: number[];
  categoriesCreated: number;
  stockMovementsCreated: number;
};

export async function applyProductImportBatch(args: {
  organizationId: string;
  userId: string;
  locationId: string;
  rows: ClassifiedProductRow[];
  budgetMs?: number;
}): Promise<ProductImportBatchOutcome> {
  // Categories auto-created during this batch, keyed by normalizeCategoryKey,
  // so "Jus" and "JUS" in the same batch create exactly one Category (§4).
  // Updated only after a line's transaction actually commits. Across batches
  // resolveCategory re-checks inside every transaction (case-insensitive), and
  // the next batch's classification preloads the categories created before.
  const createdCategoryIds = new Map<string, string>();
  let categoriesCreated = 0;
  let stockMovementsCreated = 0;

  const { results: outcomes, deferred } = await processUntilBudget(
    args.rows,
    (row) =>
      applyRow(args.organizationId, args.userId, args.locationId, row, createdCategoryIds),
    { budgetMs: args.budgetMs ?? PRODUCT_IMPORT_BATCH_TIME_BUDGET_MS },
  );

  for (const outcome of outcomes) {
    categoriesCreated += outcome.categoryCreated ? 1 : 0;
    stockMovementsCreated += outcome.stockMovementCreated ? 1 : 0;
  }

  return {
    results: outcomes.map((outcome) => outcome.result),
    deferred: deferred.map((row) => row.excelRow),
    categoriesCreated,
    stockMovementsCreated,
  };
}

async function applyRow(
  organizationId: string,
  userId: string,
  locationId: string,
  row: ClassifiedProductRow,
  createdCategoryIds: Map<string, string>,
): Promise<RowOutcome> {
  const meta = { excelRow: row.excelRow, reference: row.reference, name: row.name };
  const idle = { categoryCreated: false, stockMovementCreated: false };

  if (row.status === "CONFLICT") {
    return { result: { ...meta, status: "CONFLICT", message: row.message }, ...idle };
  }
  if (row.status === "ERROR") {
    return { result: { ...meta, status: "ERROR", message: row.message }, ...idle };
  }
  if (row.status === "EXISTING_UNCHANGED") {
    return { result: { ...meta, status: "UNCHANGED", message: "Produit inchangé." }, ...idle };
  }
  if (!row.supplierId) {
    return { result: { ...meta, status: "ERROR", message: `Fournisseur introuvable : ${row.supplierCode}` }, ...idle };
  }
  if (row.status === "EXISTING_UPDATE" && !row.existingId) {
    return { result: { ...meta, status: "ERROR", message: "Produit introuvable au moment de la mise à jour." }, ...idle };
  }

  const supplierId = row.supplierId;
  const categoryKey = normalizeCategoryKey(row.categoryName);

  try {
    const applied = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const category = await resolveCategory(
            tx,
            organizationId,
            row,
            createdCategoryIds.get(categoryKey) ?? row.categoryId,
          );

          const productId =
            row.status === "NEW"
              ? await createProductRow(tx, organizationId, row, category.id, supplierId)
              : await updateProductRow(tx, organizationId, row.existingId!, row, category.id, supplierId);

          const stockMovementCreated = await syncStock(
            tx,
            organizationId,
            userId,
            locationId,
            productId,
            row.targetStock,
          );

          return { categoryId: category.id, categoryCreated: category.created, stockMovementCreated };
        },
        { isolationLevel: "Serializable" },
      ),
    );

    if (applied.categoryCreated) createdCategoryIds.set(categoryKey, applied.categoryId);

    return {
      result: {
        ...meta,
        status: row.status === "NEW" ? "CREATED" : "UPDATED",
        message: row.status === "NEW" ? "Produit créé." : "Produit mis à jour.",
      },
      categoryCreated: applied.categoryCreated,
      stockMovementCreated: applied.stockMovementCreated,
    };
  } catch (error) {
    return { result: mapRowError(meta, error), ...idle };
  }
}

async function resolveCategory(
  tx: Prisma.TransactionClient,
  organizationId: string,
  row: ClassifiedProductRow,
  knownId: string | null,
): Promise<{ id: string; created: boolean }> {
  if (knownId) return { id: knownId, created: false };

  // Re-check inside the transaction: a category with this name may exist now
  // (created since the preload, or by an earlier line). Case-insensitive so
  // "JUS" reuses an existing "Jus".
  const existing = await tx.category.findFirst({
    where: { organizationId, name: { equals: row.categoryName.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const code = await nextCategoryCode(tx, organizationId);
  const created = await tx.category.create({
    data: { organizationId, code, name: row.categoryName.trim(), active: true },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function createProductRow(
  tx: Prisma.TransactionClient,
  organizationId: string,
  row: ClassifiedProductRow,
  categoryId: string,
  supplierId: string,
): Promise<string> {
  const product = await tx.product.create({
    data: {
      organizationId,
      reference: row.reference,
      name: row.name,
      categoryId,
      defaultSupplierId: supplierId,
      purchasePrice: row.purchasePriceHT,
      salePrice: row.salePriceHT,
      taxRate: row.taxRate,
      unit: "unité",
      minimumStock: 0,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return product.id;
}

async function updateProductRow(
  tx: Prisma.TransactionClient,
  organizationId: string,
  id: string,
  row: ClassifiedProductRow,
  categoryId: string,
  supplierId: string,
): Promise<string> {
  const { count } = await tx.product.updateMany({
    where: { id, organizationId },
    data: {
      name: row.name,
      categoryId,
      defaultSupplierId: supplierId,
      purchasePrice: row.purchasePriceHT,
      salePrice: row.salePriceHT,
      taxRate: row.taxRate,
      // §9: barcode / brandId / unit / minimumStock / status left untouched.
    },
  });
  if (count === 0) {
    throw new OperationsServiceError("Produit introuvable au moment de la mise à jour.", 404);
  }
  return id;
}

/**
 * Import-only stock sync. QuantiteStock is a TARGET, never an addition:
 * delta = target - current, applied as one INVENTORY_ADJUSTMENT movement,
 * and skipped entirely when delta is 0 (idempotent re-import, §14). A
 * negative target IS allowed here - unlike createStockAdjustment /
 * applyStockMovement, whose "stock >= 0" guard is deliberately kept for
 * /stock and /inventaire. Returns true when a movement was written.
 */
async function syncStock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  locationId: string,
  productId: string,
  targetStock: number,
): Promise<boolean> {
  const level = await tx.stockLevel.upsert({
    where: { productId_locationId: { productId, locationId } },
    update: {},
    create: { organizationId, productId, locationId, quantity: 0, reservedQuantity: 0 },
    select: { id: true, quantity: true },
  });

  const delta = targetStock - level.quantity;
  if (delta === 0) return false;

  await tx.stockLevel.update({
    where: { id: level.id },
    data: { quantity: targetStock },
  });

  await tx.stockMovement.create({
    data: {
      organizationId,
      movementNumber: await nextMovementNumber(tx, organizationId),
      type: "INVENTORY_ADJUSTMENT",
      productId,
      quantity: Math.abs(delta),
      sourceLocationId: delta < 0 ? locationId : null,
      destinationLocationId: delta > 0 ? locationId : null,
      referenceType: "PRODUCT_IMPORT",
      referenceId: null,
      reason: "Import Excel produits",
      // Same "ADJUSTMENT_SNAPSHOT:{...}" note shape as
      // stock-movements.ts#buildAdjustmentNote, so /stock's movement table
      // renders the before/after for import movements too.
      note: `ADJUSTMENT_SNAPSHOT:${JSON.stringify({
        beforeQuantity: level.quantity,
        afterQuantity: targetStock,
        deltaQuantity: delta,
      })}`,
      createdByUserId: userId,
      status: "VALIDATED",
    },
  });

  return true;
}

function mapRowError(
  meta: Omit<ImportRowResult, "status" | "message">,
  error: unknown,
): ImportRowResult {
  const prismaError = error as { code?: string; meta?: { target?: string[] | string } };

  if (prismaError.code === "P2002") {
    const target = Array.isArray(prismaError.meta?.target)
      ? prismaError.meta.target.join(",")
      : String(prismaError.meta?.target ?? "");
    if (target.includes("reference") || target.includes("barcode")) {
      return { ...meta, status: "UNCHANGED", message: "Produit déjà présent." };
    }
    return { ...meta, status: "CONFLICT", message: "Conflit d'unicité sur cette ligne." };
  }

  if (error instanceof OperationsServiceError) {
    return {
      ...meta,
      status: error.status === 409 ? "CONFLICT" : "ERROR",
      message: error.message,
    };
  }

  return { ...meta, status: "ERROR", message: "Import impossible pour cette ligne." };
}

// Same shape as stock-movements.ts / categories.ts / counter-sales.ts etc.:
// each module keeps its own private copy. Retries only P2034 (Postgres
// serialization failure under Serializable isolation); every other error
// (validation, not-found, unique violation) is rethrown on the first attempt.
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 40): Promise<T> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string; message?: string };
      attempt += 1;
      const isRetryable =
        prismaError.code === "P2034" ||
        (prismaError.code === "P2010" && /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) throw error;
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }
  throw new OperationsServiceError("Impossible de finaliser l'import de cette ligne.", 500);
}
