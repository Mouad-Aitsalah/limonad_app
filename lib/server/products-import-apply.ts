import "server-only";

import { prisma } from "@/lib/prisma";
import type { ClassifiedProductRow } from "@/lib/products-import-rules";
import { writeImportBatch, type ImportWriteStore, type ProductImportBatchOutcome } from "@/lib/products-import-writer";
import { nextCategoryCode } from "@/lib/server/categories";
import { OperationsServiceError } from "@/lib/server/depots";
import { productImportLineTx, type ImportSequences } from "@/lib/server/products-import-core";
import { nextMovementNumber } from "@/lib/server/sales-shared";

/** The real document numbers (category code, stock movement number) used by the core. */
const IMPORT_SEQUENCES: ImportSequences = {
  nextCategoryCode: (tx, organizationId) => nextCategoryCode(tx, organizationId),
  nextMovementNumber: (tx, organizationId) => nextMovementNumber(tx, organizationId),
};

export type { ImportRowResult, ImportRowStatus, ProductImportBatchOutcome } from "@/lib/products-import-writer";

/**
 * The real write of the products import, for ONE batch of already classified lines:
 * the Prisma implementation of the store lib/products-import-writer.ts writes
 * through (that module holds the per-line rules and is unit tested).
 *
 * Here: each line runs in its OWN Serializable transaction (retried on serialization
 * failures only), and every query is scoped to the caller's organisation and depot
 * StockLocation - never to a value of the file. The queries themselves live in
 * lib/server/products-import-core.ts (testable on a database without Next).
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
        prisma.$transaction((tx) => work(productImportLineTx(tx, organizationId, userId, locationId, IMPORT_SEQUENCES)), {
          isolationLevel: "Serializable",
        }),
      ),
    describeError: (error) =>
      error instanceof OperationsServiceError ? { status: error.status, message: error.message } : null,
  };
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
