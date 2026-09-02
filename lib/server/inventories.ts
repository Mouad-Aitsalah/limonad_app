import "server-only";

import { z } from "zod";

import { roundMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import type { InventoryGetPayload } from "@/lib/generated/prisma/models/Inventory";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { UserRole } from "@/types/auth";
import type {
  InventoryCreateInput,
  InventoryDto,
  InventoryLineDto,
  InventoryLineSaveInput,
  InventorySummaryDto,
} from "@/types/operations-dto";

const managerRoles: UserRole[] = ["admin", "depot_manager"];

const inventoryLineInclude = {
  product: {
    select: { id: true, reference: true, name: true, barcode: true, unit: true },
  },
} as const;

const inventoryInclude = {
  depot: { select: { id: true, name: true } },
  createdBy: { select: { fullName: true } },
  lines: {
    include: inventoryLineInclude,
    orderBy: { createdAt: "asc" },
  },
} as const;

type InventoryWithRelations = InventoryGetPayload<{ include: typeof inventoryInclude }>;
type InventoryLineWithRelations = InventoryWithRelations["lines"][number];

export type InventoryTotalsDto = {
  linesCount: number;
  totalValue: number;
  totalStockBefore: number;
  totalDifference: number;
};

function computeTotals(lines: InventoryLineWithRelations[]): InventoryTotalsDto {
  return lines.reduce(
    (totals, line) => {
      totals.linesCount += 1;
      totals.totalValue = roundMoney(totals.totalValue + line.lineValue.toNumber());
      totals.totalStockBefore += line.stockBefore;
      totals.totalDifference += line.differenceQuantity;
      return totals;
    },
    { linesCount: 0, totalValue: 0, totalStockBefore: 0, totalDifference: 0 },
  );
}

function mapLineToDto(line: InventoryLineWithRelations): InventoryLineDto {
  return {
    id: line.id,
    productId: line.productId,
    productReference: line.product.reference,
    productName: line.product.name,
    productBarcode: line.product.barcode,
    productUnit: line.product.unit,
    stockBefore: line.stockBefore,
    unitCost: line.unitCost.toNumber(),
    physicalQuantity: line.physicalQuantity,
    differenceQuantity: line.differenceQuantity,
    lineValue: line.lineValue.toNumber(),
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}

function mapInventoryToSummaryDto(inventory: InventoryWithRelations): InventorySummaryDto {
  const totals = computeTotals(inventory.lines);
  return {
    id: inventory.id,
    number: inventory.number,
    displayNumber: `INV-${String(inventory.number).padStart(4, "0")}`,
    status: inventory.status,
    depotId: inventory.depotId,
    depotName: inventory.depot.name,
    createdByUserName: inventory.createdBy.fullName,
    createdAt: inventory.createdAt.toISOString(),
    finishedAt: inventory.finishedAt?.toISOString() ?? null,
    ...totals,
  };
}

function mapInventoryToDto(inventory: InventoryWithRelations): InventoryDto {
  return {
    ...mapInventoryToSummaryDto(inventory),
    lines: inventory.lines.map(mapLineToDto),
  };
}

export async function getInventoryHistory(): Promise<InventorySummaryDto[]> {
  const currentUser = await requireOrganizationUser(managerRoles);
  const inventories = await prisma.inventory.findMany({
    where: { organizationId: currentUser.organizationId },
    include: inventoryInclude,
    orderBy: { number: "desc" },
  });
  return inventories.map(mapInventoryToSummaryDto);
}

const inventoryCreateSchema = z.object({
  depotId: z.string().trim().min(1, "Le depot est obligatoire."),
});

export async function createInventory(input: InventoryCreateInput): Promise<InventoryDto> {
  const user = await requireOrganizationUser(managerRoles);
  const parsed = inventoryCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const inventory = await withInventorySerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const depot = await tx.depot.findFirst({
          where: {
            id: parsed.data.depotId,
            organizationId: user.organizationId,
          },
          select: { id: true },
        });
        if (!depot) throw new OperationsServiceError("Depot introuvable.", 404);

        // F7 (Phase 2 audit): at most one EN_COURS inventory per depot at a
        // time. Checked first, inside this Serializable transaction - the
        // isolation level makes two concurrent createInventory calls for
        // the same depot behave as if run one after another (Postgres
        // aborts one with a P2034 serialization failure rather than
        // letting both see "no open inventory"), and
        // Inventory_open_per_depot_key (partial unique index, see the
        // schema.prisma doc comment on Inventory) is the last line of
        // defense if that were ever bypassed - withInventorySerializableRetry
        // retries both codes, and the retried attempt re-reads this check
        // and finds the other transaction's now-committed inventory,
        // producing this same clear error instead of a raw constraint
        // violation.
        const openInventory = await tx.inventory.findFirst({
          where: {
            organizationId: user.organizationId,
            depotId: depot.id,
            status: "EN_COURS",
          },
          select: { id: true, number: true },
        });
        if (openInventory) {
          throw new OperationsServiceError(
            `Un inventaire est deja en cours pour ce depot (INV-${String(openInventory.number).padStart(4, "0")}). ` +
              "Terminez-le avant d'en demarrer un nouveau.",
            409,
            { depotId: "Un inventaire est deja en cours pour ce depot." },
          );
        }

        const number = await nextInventoryNumber(tx, user.organizationId);
        const created = await tx.inventory.create({
          data: {
            organizationId: user.organizationId,
            number,
            depotId: depot.id,
            createdByUserId: user.id,
          },
        });

        return tx.inventory.findUniqueOrThrow({
          where: { id: created.id },
          include: inventoryInclude,
        });
      },
      // 15s: same fix already applied to counter-sales.ts / credit-notes.ts's
      // equivalent transactions - can exceed Prisma's 5s default
      // interactive-transaction timeout (P2028) against Neon's serverless
      // connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapInventoryToDto(inventory);
}

// Same pattern already used by truck-loadings.ts's
// withLoadingSerializableRetry / credit-notes.ts's
// withIdempotentSerializableRetry: retries both P2034 (Serializable
// isolation conflict) and P2002 (Inventory_open_per_depot_key, the last-line
// defense) so a genuinely simultaneous race still converges on the same
// clean "deja en cours" business error instead of a raw constraint
// violation surfacing to the caller.
// Phase 3: two changes to this pre-existing helper, both required to keep
// finalizeInventory's new query architecture (§1 of the doc comment above)
// exactly as safe under concurrency as before this rewrite:
//
// 1. isRetryableConflict now also recognizes P2010 wrapping Postgres
//    SQLSTATE 40001/40P01. Every ORM-level Prisma write (create/update/
//    upsert/createMany/...) already surfaced a Serializable conflict as
//    P2034, which this helper already retried - but tx.$executeRaw (the
//    bulk StockLevel UPDATE ... FROM VALUES this rewrite introduces, see
//    the finalizeInventory doc comment) surfaces the EXACT SAME underlying
//    conflict differently: Prisma wraps it as P2010 ("Raw query failed")
//    with the real Postgres error code/message inside. Confirmed by direct
//    reproduction under real concurrent finalizeInventory calls before this
//    fix: an attempt whose conflict happened to land on the raw UPDATE
//    instead of the ORM update was thrown immediately as an unmapped raw
//    error instead of being retried, surfacing a generic 500 while every
//    other interleaving already worked cleanly. 40P01 (deadlock_detected)
//    is included alongside 40001 (serialization_failure) for the same
//    reason - both are "this transaction lost, retry it" conditions, not
//    logic errors.
// 2. maxAttempts raised 3 -> 5, and retry-exhaustion now throws a clean,
//    retryable OperationsServiceError instead of re-throwing the last raw
//    Prisma error - sustained contention (several truly concurrent callers
//    on the same inventory) can still exhaust even a generous retry budget,
//    and the Phase 3 spec requires a clean business result under
//    concurrency in every case, not just the common one.
// Phase 3 - numbering chantier: was an inline tx.inventory.count()+1 (O(n),
// scans every historical inventory for the org). Display format
// ("INV-0001", zero-padded to 4 digits) is unchanged - only the raw Int
// stored on Inventory.number now comes from the shared atomic counter.
async function nextInventoryNumber(
  tx: Pick<typeof prisma, "inventory" | "$queryRaw">,
  organizationId: string,
) {
  return reserveDocumentSequence(tx, organizationId, DocumentType.Inventory);
}

function isRetryableConflict(error: unknown): boolean {
  const prismaError = error as { code?: string; message?: string };
  if (["P2002", "P2034"].includes(prismaError.code ?? "")) return true;
  if (prismaError.code === "P2010") {
    const message = prismaError.message ?? "";
    return message.includes("40001") || message.includes("40P01");
  }
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withInventorySerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 40): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;

      if (!isRetryableConflict(error)) {
        throw error;
      }
      if (attempt >= maxAttempts) {
        throw new OperationsServiceError(
          "Une autre operation est en cours sur cet inventaire. Veuillez reessayer dans un instant.",
          409,
        );
      }
      // Jittered backoff: under N-way true-simultaneous contention on the
      // same counter row, retrying instantly just re-collides with the same
      // herd (empirically verified: without this, 50-100-way concurrent
      // reserveDocumentSequence() calls exhausted immediate retries - see
      // scripts/_tmp-test-real-generators.ts in the Phase 3 numbering
      // chantier report).
      await sleep(Math.min(800, 10 * 1.5 ** attempt) * (0.5 + Math.random()));
    }
  }

  throw new OperationsServiceError("Impossible de creer l'inventaire.", 500);
}

export async function getInventoryById(id: string): Promise<InventoryDto> {
  const currentUser = await requireOrganizationUser(managerRoles);
  const inventory = await prisma.inventory.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    include: inventoryInclude,
  });
  if (!inventory) throw new OperationsServiceError("Inventaire introuvable.", 404);
  return mapInventoryToDto(inventory);
}

const lineSaveSchema = z.object({
  productId: z.string().trim().min(1, "Le produit est obligatoire."),
  // Deliberately a plain min(0) int, not a truthy check: 0 is a fully valid
  // physical count and must never be treated as "empty".
  physicalQuantity: z.coerce
    .number()
    .int("La quantite doit etre un nombre entier.")
    .min(0, "La quantite ne peut pas etre negative."),
});

/**
 * Saves exactly one line, called on every Enter-after-quantity keystroke.
 * A second save of a product already in this inventory corrects the
 * existing line in place (upsert on the [inventoryId, productId] unique
 * index) instead of creating a duplicate - and never re-snapshots
 * stockBefore/unitCost, which stay frozen to their value the first time the
 * product was added. Returns only the saved line + fresh aggregate totals,
 * not the whole inventory, so the caller never has to refetch a
 * possibly-huge line list just to save one row.
 */
export async function saveInventoryLine(
  inventoryId: string,
  input: InventoryLineSaveInput,
): Promise<{ line: InventoryLineDto; totals: InventoryTotalsDto }> {
  const currentUser = await requireOrganizationUser(managerRoles);
  const parsed = lineSaveSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.findFirst({
      where: { id: inventoryId, organizationId: currentUser.organizationId },
      select: { id: true, status: true, depotId: true },
    });
    if (!inventory) throw new OperationsServiceError("Inventaire introuvable.", 404);
    if (inventory.status !== "EN_COURS") {
      throw new OperationsServiceError(
        "Cet inventaire est termine et n'est plus modifiable.",
        409,
      );
    }

    const product = await tx.product.findFirst({
      where: {
        id: parsed.data.productId,
        organizationId: currentUser.organizationId,
      },
      select: { id: true, purchasePrice: true, status: true },
    });
    if (!product || product.status !== "ACTIVE") {
      throw new OperationsServiceError("Produit introuvable.", 422);
    }

    const existingLine = await tx.inventoryLine.findUnique({
      where: {
        inventoryId_productId: { inventoryId, productId: parsed.data.productId },
      },
      select: { stockBefore: true, unitCost: true },
    });

    let stockBefore: number;
    let unitCost: number;
    if (existingLine) {
      stockBefore = existingLine.stockBefore;
      unitCost = existingLine.unitCost.toNumber();
    } else {
      const depotLocation = await tx.stockLocation.findFirst({
        where: {
          depotId: inventory.depotId,
          organizationId: currentUser.organizationId,
        },
        select: { id: true },
      });
      if (!depotLocation) {
        throw new OperationsServiceError("Emplacement de stock du depot introuvable.", 404);
      }
      const level = await tx.stockLevel.findUnique({
        where: {
          productId_locationId: { productId: parsed.data.productId, locationId: depotLocation.id },
        },
        select: { quantity: true },
      });
      stockBefore = level?.quantity ?? 0;
      unitCost = product.purchasePrice.toNumber();
    }

    const physicalQuantity = parsed.data.physicalQuantity;
    const differenceQuantity = physicalQuantity - stockBefore;
    const lineValue = roundMoney(physicalQuantity * unitCost);
    // F8-F: lineValue is Decimal(12,2) - a large-but-plausible physical
    // count times a large-but-plausible unit cost is exactly the case a
    // bound on either factor alone would miss (see
    // lib/money.ts#isWithinMoneyRange). Checked before the first write in
    // this transaction (the upsert just below).
    assertMoneyRange(lineValue, "inventoryLine.lineValue");

    const saved = await tx.inventoryLine.upsert({
      where: {
        inventoryId_productId: { inventoryId, productId: parsed.data.productId },
      },
      update: { physicalQuantity, differenceQuantity, lineValue },
      create: {
        inventoryId,
        productId: parsed.data.productId,
        stockBefore,
        unitCost,
        physicalQuantity,
        differenceQuantity,
        lineValue,
      },
      include: inventoryLineInclude,
    });

    const allLines = await tx.inventoryLine.findMany({
      where: { inventoryId },
      select: { lineValue: true, stockBefore: true, differenceQuantity: true },
    });
    const totals = allLines.reduce(
      (acc, line) => {
        acc.linesCount += 1;
        acc.totalValue = roundMoney(acc.totalValue + line.lineValue.toNumber());
        acc.totalStockBefore += line.stockBefore;
        acc.totalDifference += line.differenceQuantity;
        return acc;
      },
      { linesCount: 0, totalValue: 0, totalStockBefore: 0, totalDifference: 0 },
    );

    return { line: saved, totals };
  });

  return { line: mapLineToDto(result.line), totals: result.totals };
}

/**
 * "Terminer l'inventaire" is the only action that ever touches real stock:
 * for each line, StockLevel is set to exactly the counted physicalQuantity
 * (matching the "restante reelle" pattern already used for chargements), and
 * an INVENTORY_ADJUSTMENT movement records the delta against whatever the
 * live stock actually is at this moment (not the frozen stockBefore
 * snapshot, which is history/context only) - so nothing is silently
 * double-applied if stock moved during the EN_COURS period.
 *
 * Phase 3 rewrite: the original implementation did ONE sequential
 * findUnique + upsert + count()-for-numbering + create per line (~4N
 * queries - see the Phase 3-A audit report), which timed out past ~150-200
 * lines and failed outright at 300/700. This version does the exact same
 * business logic - same final StockLevel per product, same StockMovement
 * shape/count, same "skip if delta is exactly 0" rule - but in a fixed
 * small number of round trips regardless of N:
 *   1. one findMany batch-reads every StockLevel this inventory touches
 *      (replaces N sequential findUnique calls);
 *   2. the movementNumber sequence base is read ONCE (not once per line)
 *      and every subsequent number is computed in memory - safe under the
 *      Serializable isolation already in place: a genuinely concurrent
 *      writer racing for the same numbers aborts with P2034/P2002, and
 *      withInventorySerializableRetry (already used above) retries with a
 *      freshly re-read base, exactly as before this rewrite;
 *   3. StockLevel writes are split into a createMany (products with no
 *      existing row) and a single parameterized bulk UPDATE ... FROM
 *      (VALUES ...) statement (products being corrected) - Prisma has no
 *      bulk-upsert-with-per-row-values primitive, and updateMany can only
 *      apply the same value to every matched row, so this is the one place
 *      genuinely requiring raw SQL; every value is bound as a query
 *      parameter, never concatenated;
 *   4. StockMovement rows are written with one createMany.
 * The @@unique([organizationId, movementNumber]) constraint and the
 * Serializable/retry wrapper are untouched - they remain the actual
 * correctness guarantee, this rewrite only removes the redundant
 * round-trips around them. A real DB sequence would remove the retry
 * dependency entirely for numbering, but that is a bigger, separate
 * migration deliberately left out of this chantier.
 */
export async function finalizeInventory(id: string): Promise<InventoryDto> {
  const user = await requireOrganizationUser(managerRoles);

  // F10: current.status is re-checked fresh on every attempt, so a retry
  // after a Serializable conflict (P2034) either safely re-runs the
  // finalization (if still EN_COURS) or cleanly hits the "deja termine" 409
  // below (if a concurrent finalization already committed) - never a
  // double StockMovement/adjustment. Reuses withInventorySerializableRetry,
  // already defined in this file (see createInventory above).
  const inventory = await withInventorySerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const current = await tx.inventory.findFirst({
        where: { id, organizationId: user.organizationId },
        select: {
          id: true,
          number: true,
          status: true,
          depotId: true,
          lines: { select: { productId: true, physicalQuantity: true } },
        },
      });
      if (!current) throw new OperationsServiceError("Inventaire introuvable.", 404);
      if (current.status === "TERMINE") {
        throw new OperationsServiceError("Cet inventaire est deja termine.", 409);
      }
      if (current.lines.length === 0) {
        throw new OperationsServiceError(
          "Ajoutez au moins un produit avant de terminer l'inventaire.",
          422,
        );
      }

      const depotLocation = await tx.stockLocation.findFirst({
        where: {
          depotId: current.depotId,
          organizationId: user.organizationId,
        },
        select: { id: true },
      });
      if (!depotLocation) {
        throw new OperationsServiceError("Emplacement de stock du depot introuvable.", 404);
      }

      // 1. Batch-read every StockLevel this inventory could touch in ONE
      // query - replaces the original's N sequential findUnique calls.
      // Scoped to this exact locationId + the productIds actually on this
      // inventory, so it never reads (or risks touching) another depot's
      // stock.
      const productIds = current.lines.map((line) => line.productId);
      const existingLevels = await tx.stockLevel.findMany({
        where: { locationId: depotLocation.id, productId: { in: productIds } },
        select: { productId: true, quantity: true },
      });
      const liveQuantityByProductId = new Map(
        existingLevels.map((level) => [level.productId, level.quantity]),
      );

      type DeltaLine = {
        productId: string;
        physicalQuantity: number;
        liveQuantity: number;
        delta: number;
        hasExistingLevel: boolean;
      };
      const deltaLines: DeltaLine[] = [];
      for (const line of current.lines) {
        const hasExistingLevel = liveQuantityByProductId.has(line.productId);
        const liveQuantity = liveQuantityByProductId.get(line.productId) ?? 0;
        const delta = line.physicalQuantity - liveQuantity;
        // Same rule as before this rewrite: a line whose physical count
        // exactly matches live stock produces no StockMovement and no
        // StockLevel write at all - only lines with a real difference do.
        if (delta === 0) continue;
        deltaLines.push({ productId: line.productId, physicalQuantity: line.physicalQuantity, liveQuantity, delta, hasExistingLevel });
      }

      if (deltaLines.length > 0) {
        // 2. Movement numbering base read ONCE, not once per delta line -
        // see the function doc comment above for the concurrency argument.
        const baseMovementCount = await tx.stockMovement.count({
          where: { organizationId: user.organizationId },
        });

        const toCreate = deltaLines.filter((line) => !line.hasExistingLevel);
        const toUpdate = deltaLines.filter((line) => line.hasExistingLevel);

        // 3a. New StockLevel rows (product never stocked at this location
        // before) - a plain Prisma createMany, one round trip, ids
        // generated by Prisma exactly as a normal create() would.
        if (toCreate.length > 0) {
          const created = await tx.stockLevel.createMany({
            data: toCreate.map((line) => ({
              organizationId: user.organizationId,
              productId: line.productId,
              locationId: depotLocation.id,
              quantity: line.physicalQuantity,
              reservedQuantity: 0,
            })),
          });
          if (created.count !== toCreate.length) {
            throw new OperationsServiceError("Impossible de finaliser l'inventaire.", 500);
          }
        }

        // 3b. Existing StockLevel rows each need a DIFFERENT quantity value
        // - Prisma's updateMany applies one value to every matched row, and
        // there is no bulk-upsert-with-per-row-values primitive, so this is
        // the one genuinely necessary raw-SQL statement. Every value is a
        // bound parameter (via Prisma.sql/Prisma.join's tagged templates,
        // never string concatenation); locationId is fixed to this single
        // depot's location, so this can only ever touch rows already
        // scoped to this exact organization/depot's stock.
        if (toUpdate.length > 0) {
          const valueRows = toUpdate.map(
            (line) => Prisma.sql`(${line.productId}::text, ${line.physicalQuantity}::int)`,
          );
          const affected = await tx.$executeRaw`
            UPDATE "StockLevel" AS sl
            SET quantity = v.quantity, "updatedAt" = NOW()
            FROM (VALUES ${Prisma.join(valueRows)}) AS v("productId", quantity)
            WHERE sl."productId" = v."productId" AND sl."locationId" = ${depotLocation.id}
          `;
          if (affected !== toUpdate.length) {
            throw new OperationsServiceError("Impossible de finaliser l'inventaire.", 500);
          }
        }

        // 4. One StockMovement per delta line, same shape/fields as before
        // this rewrite, written in a single createMany instead of N
        // sequential creates.
        const movements = deltaLines.map((line, index) => ({
          organizationId: user.organizationId,
          movementNumber: `MV-${String(baseMovementCount + 1 + index).padStart(6, "0")}`,
          type: "INVENTORY_ADJUSTMENT" as const,
          productId: line.productId,
          quantity: Math.abs(line.delta),
          sourceLocationId: line.delta < 0 ? depotLocation.id : null,
          destinationLocationId: line.delta > 0 ? depotLocation.id : null,
          referenceType: "INVENTORY",
          referenceId: current.id,
          reason: "Cloture inventaire - correction stock reel",
          note: JSON.stringify({
            inventoryNumber: current.number,
            previousQuantity: line.liveQuantity,
            physicalQuantity: line.physicalQuantity,
            delta: line.delta,
          }),
          createdByUserId: user.id,
          status: "VALIDATED" as const,
        }));
        const createdMovements = await tx.stockMovement.createMany({ data: movements });
        if (createdMovements.count !== movements.length) {
          throw new OperationsServiceError("Impossible de finaliser l'inventaire.", 500);
        }
      }

      return tx.inventory.update({
        where: { id },
        data: { status: "TERMINE", finishedAt: new Date() },
        include: inventoryInclude,
      });
      },
      // Still Serializable (unchanged correctness guarantee). The timeout
      // budget itself is intentionally left as-is in this chantier (see the
      // Phase 3 instructions: the fix must come from fewer round trips, not
      // a bigger timeout) - now vastly oversized relative to the new,
      // batched query count, kept only as a safety ceiling.
      { isolationLevel: "Serializable", timeout: 120000 },
    ),
  );

  return mapInventoryToDto(inventory);
}

export function mapInventoryError(error: unknown) {
  if (error instanceof OperationsServiceError) return error;
  const prismaError = error as { code?: string };
  if (prismaError.code === "P2025") {
    return new OperationsServiceError("Inventaire introuvable.", 404);
  }
  return new OperationsServiceError("Une erreur est survenue.", 500);
}
