import { NextResponse } from "next/server";
import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthServiceError } from "@/lib/server/auth";
import { nextCategoryCode } from "@/lib/server/categories";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import {
  classifyProductImportRows,
  normalizeCategoryKey,
  productImportSchema,
  resolveImportDepotTarget,
  type ClassifiedProductRow,
} from "@/lib/server/products-import";
import { nextMovementNumber } from "@/lib/server/sales-shared";

// Each line is one short Serializable transaction; a large file needs room
// past the default serverless limit.
export const maxDuration = 60;

type ImportRowStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "ERROR";

type ImportRowResult = {
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

/**
 * POST /api/produits/import - the real write behind "Importer les produits".
 *
 * The row list is re-classified here from scratch (classifyProductImportRows,
 * exactly what the preview runs - the browser's statuses are never trusted).
 * Each importable line is then applied in its OWN Serializable transaction:
 * Product (+ a Category created on the fly) + StockLevel + StockMovement
 * commit or roll back together (§15). A failing line is reported as
 * ERROR/CONFLICT without rolling back the lines already done (§10). Stock is
 * a TARGET, not an addition: a re-import of the same file finds delta 0 and
 * writes no extra movement (§14, idempotent).
 *
 * Every read and write is scoped to the caller's organisation and to the
 * caller's own depot StockLocation - never a request parameter.
 */
export async function POST(request: Request) {
  try {
    const input = productImportSchema.parse(await request.json());
    const user = await requireOrganizationUser(["admin", "depot_manager"]);

    if (input.rows.length === 0) {
      return NextResponse.json({ message: "Aucune ligne à importer." }, { status: 422 });
    }

    const depot = await resolveImportDepotTarget(user.organizationId, user.id);
    const { rows } = await classifyProductImportRows(
      user.organizationId,
      depot.locationId,
      input.rows,
    );

    // Categories auto-created during this run, keyed by normalizeCategoryKey,
    // so "Jus" and "JUS" in the same file create exactly one Category (§4).
    // Updated only after a line's transaction actually commits.
    const createdCategoryIds = new Map<string, string>();
    let categoriesCreated = 0;
    let stockMovementsCreated = 0;

    const results: ImportRowResult[] = [];
    for (const row of rows) {
      const outcome = await applyRow(
        user.organizationId,
        user.id,
        depot.locationId,
        row,
        createdCategoryIds,
      );
      results.push(outcome.result);
      categoriesCreated += outcome.categoryCreated ? 1 : 0;
      stockMovementsCreated += outcome.stockMovementCreated ? 1 : 0;
    }

    const countStatus = (status: ImportRowStatus) =>
      results.filter((row) => row.status === status).length;

    return NextResponse.json({
      summary: {
        created: countStatus("CREATED"),
        updated: countStatus("UPDATED"),
        unchanged: countStatus("UNCHANGED"),
        conflicts: countStatus("CONFLICT"),
        errors: countStatus("ERROR"),
      },
      categoriesCreated,
      stockMovementsCreated,
      depot: { name: depot.depotName, code: depot.depotCode },
      rows: results,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Lignes import invalides." }, { status: 422 });
    }
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'importer les produits." }, { status: 500 });
  }
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
