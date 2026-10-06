import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ClassifiedProductRow } from "@/lib/products-import-rules";
import {
  writeImportBatch,
  type ImportLineTx,
  type ImportWriteStore,
  type ProductImportBatchOutcome,
} from "@/lib/products-import-writer";
import { nextCategoryCode } from "@/lib/server/categories";
import { OperationsServiceError } from "@/lib/server/depots";
import { nextMovementNumber } from "@/lib/server/sales-shared";

export type { ImportRowResult, ImportRowStatus, ProductImportBatchOutcome } from "@/lib/products-import-writer";

/**
 * The real write of the products import, for ONE batch of already classified lines:
 * the Prisma implementation of the store lib/products-import-writer.ts writes
 * through (that module holds the per-line rules and is unit tested).
 *
 * Here: each line runs in its OWN Serializable transaction (retried on serialization
 * failures only), and every query is scoped to the caller's organisation and depot
 * StockLocation - never to a value of the file. The queries are the ones the import
 * always ran (moved here unchanged); the supplier lookup / creation is the new part.
 */
export async function applyProductImportBatch(args: {
  organizationId: string;
  userId: string;
  locationId: string;
  rows: ClassifiedProductRow[];
  budgetMs?: number;
}): Promise<ProductImportBatchOutcome> {
  return writeImportBatch(prismaImportStore(args.organizationId, args.userId, args.locationId), args.rows, {
    budgetMs: args.budgetMs,
  });
}

function prismaImportStore(organizationId: string, userId: string, locationId: string): ImportWriteStore {
  return {
    runLine: (work) =>
      withSerializableRetry(() =>
        prisma.$transaction((tx) => work(lineTx(tx, organizationId, userId, locationId)), {
          isolationLevel: "Serializable",
        }),
      ),
    describeError: (error) =>
      error instanceof OperationsServiceError ? { status: error.status, message: error.message } : null,
  };
}

function lineTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  locationId: string,
): ImportLineTx {
  return {
    findSupplierByCode: (code) =>
      tx.supplier.findFirst({
        where: { organizationId, code },
        select: { id: true, active: true },
      }),

    // Same fields as the other places that create a supplier (the "Comptes" form and
    // the accounts import): organisation, code, name, active, created by. Its
    // auxiliary ledger account is NOT created here - accounting creates it, as for
    // any supplier, on its first posted purchase (lib/server/accounting.ts).
    createSupplier: ({ code, name }) =>
      tx.supplier.create({
        data: { organizationId, code, name, active: true, createdByUserId: userId },
        select: { id: true },
      }),

    findCategoryByName: (name) =>
      tx.category.findFirst({
        where: { organizationId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      }),

    createCategory: async (name) => {
      const code = await nextCategoryCode(tx, organizationId);
      return tx.category.create({
        data: { organizationId, code, name, active: true },
        select: { id: true },
      });
    },

    createProduct: (row, categoryId, supplierId) => createProductRow(tx, organizationId, row, categoryId, supplierId),

    updateProduct: (productId, row, categoryId, supplierId) =>
      updateProductRow(tx, organizationId, productId, row, categoryId, supplierId),

    syncStock: (productId, targetStock) => syncStock(tx, organizationId, userId, locationId, productId, targetStock),
  };
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
