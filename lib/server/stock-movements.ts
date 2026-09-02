import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { getStockLevel } from "@/lib/server/stock-levels";
import { nextMovementNumber } from "@/lib/server/sales-shared";
import type {
  StockAdjustmentInput,
  StockLevelDto,
  StockMovementDto,
  StockMovementsPageDto,
} from "@/types/operations-dto";

const stockMovementInclude = {
  product: { select: { reference: true, name: true } },
  sourceLocation: { select: { id: true, code: true, name: true, type: true } },
  destinationLocation: { select: { id: true, code: true, name: true, type: true } },
  createdBy: { select: { fullName: true } },
};

export const stockAdjustmentSchema = z.object({
  productId: z.string().trim().min(1, "Le produit est obligatoire."),
  locationId: z.string().trim().min(1, "L'emplacement est obligatoire."),
  quantity: z.coerce
    .number()
    .int("La quantite doit etre un nombre entier.")
    .optional()
    .default(0),
  targetQuantity: z.coerce
    .number()
    .int("La nouvelle quantite reelle doit etre un nombre entier.")
    .min(0, "Le stock reel ne peut pas etre negatif.")
    .nullable()
    .optional(),
  adjustmentMode: z.enum(["DELTA", "SET"]).optional().default("DELTA"),
  reason: z.string().trim().min(1, "Le motif est obligatoire."),
  note: z.string().trim().nullable().optional(),
  reference: z.string().trim().nullable().optional(),
  createdByUserId: z.string().trim().nullable().optional(),
  confirmActiveTour: z.coerce.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  if (data.adjustmentMode === "SET") {
    if (data.targetQuantity === null || data.targetQuantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetQuantity"],
        message: "La nouvelle quantite reelle est obligatoire.",
      });
    }
    return;
  }

  if (!data.quantity || data.quantity === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quantity"],
      message: "La quantite doit etre differente de zero.",
    });
  }
});

type MovementRecord = Awaited<ReturnType<typeof getStockMovementRecordById>>;

export function mapStockMovementToDto(
  movement: NonNullable<MovementRecord>,
): StockMovementDto {
  const location =
    movement.destinationLocation ??
    movement.sourceLocation ??
    null;
  const parsedSnapshot = parseAdjustmentSnapshot(movement.note);

  return {
    id: movement.id,
    movementNumber: movement.movementNumber,
    type: movement.type,
    productId: movement.productId,
    productReference: movement.product.reference,
    productName: movement.product.name,
    quantity: movement.quantity,
    sourceLocationId: movement.sourceLocationId,
    sourceLocationName: movement.sourceLocation?.name ?? null,
    destinationLocationId: movement.destinationLocationId,
    destinationLocationName: movement.destinationLocation?.name ?? null,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    reason: movement.reason,
    note: parsedSnapshot.cleanedNote,
    locationId: location?.id ?? null,
    locationCode: location?.code ?? null,
    locationType: location?.type ?? null,
    beforeQuantity: parsedSnapshot.beforeQuantity,
    afterQuantity: parsedSnapshot.afterQuantity,
    deltaQuantity: parsedSnapshot.deltaQuantity ?? resolveSignedQuantity(movement),
    createdByUserId: movement.createdByUserId,
    createdByUserName: movement.createdBy.fullName,
    createdAt: movement.createdAt.toISOString(),
    status: movement.status,
  };
}

const MOVEMENTS_DEFAULT_PAGE_SIZE = 25;
const MOVEMENTS_MAX_PAGE_SIZE = 100;

export type StockMovementsPageParams = {
  cursor?: string | null;
  pageSize?: number;
  productId?: string;
  /** Matches either sourceLocationId or destinationLocationId - the same
   * "history for this place" semantics the old (unbounded, now removed)
   * getStockMovementsByLocation had. */
  locationId?: string;
  type?: string;
  referenceType?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Matches movementNumber only (e.g. "MV-000210") - see the Phase 3
   * report for why a fully generic full-text search across every field
   * was not attempted here. */
  search?: string;
};

function clampMovementsPageSize(pageSize: number | undefined): number {
  const requested = Math.trunc(pageSize ?? MOVEMENTS_DEFAULT_PAGE_SIZE);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MOVEMENTS_MAX_PAGE_SIZE)
    : MOVEMENTS_DEFAULT_PAGE_SIZE;
}

function endOfDay(dateOnly: string): Date {
  const date = new Date(dateOnly);
  date.setHours(23, 59, 59, 999);
  return date;
}

function buildMovementsWhere(
  organizationId: string,
  params: StockMovementsPageParams,
): Prisma.StockMovementWhereInput {
  const where: Prisma.StockMovementWhereInput = { organizationId };

  if (params.productId) where.productId = params.productId;
  if (params.locationId) {
    where.OR = [
      { sourceLocationId: params.locationId },
      { destinationLocationId: params.locationId },
    ];
  }
  if (params.type) where.type = params.type as Prisma.StockMovementWhereInput["type"];
  if (params.referenceType) where.referenceType = params.referenceType;
  if (params.dateFrom || params.dateTo) {
    where.createdAt = {
      ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
      ...(params.dateTo ? { lte: endOfDay(params.dateTo) } : {}),
    };
  }
  const search = params.search?.trim();
  if (search) {
    where.movementNumber = { contains: search, mode: "insensitive" };
  }

  return where;
}

/**
 * Phase 3 rewrite of what used to be three separate functions:
 * getStockMovements() (take:100, no pagination, no filters - the actual
 * live source for /stock's "Mouvements de stock" table), and
 * getStockMovementsByLocation()/getStockMovementsByProduct() (both fully
 * UNBOUNDED - confirmed dead code with zero callers anywhere in the app,
 * see the Phase 3 report - but exported, and exactly the kind of landmine
 * this chantier exists to remove before anything ever calls them at scale).
 * All three are replaced by this one cursor-paginated, server-filtered
 * function; productId/locationId are now just optional filters here rather
 * than separate entry points, so any future "history for this product/
 * location" feature gets pagination for free instead of reintroducing an
 * unbounded fetch.
 *
 * Cursor: `id`, paired with `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`
 * - the same pattern already verified (exact page counts, 0 duplicates/
 * gaps) for getLoadingHistoryPage and getSalesOrdersPage in the previous
 * two Phase 3 chantiers.
 */
export async function getStockMovementsPage(
  params: StockMovementsPageParams = {},
): Promise<StockMovementsPageDto> {
  const currentUser = await requireOrganizationUser();
  const organizationId = currentUser.organizationId;
  const pageSize = clampMovementsPageSize(params.pageSize);
  const where = buildMovementsWhere(organizationId, params);

  const [rows, totalCount] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: stockMovementInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    prisma.stockMovement.count({ where }),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    items: pageRows.map(mapStockMovementToDto),
    nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    hasMore,
    totalCount,
  };
}

export async function getStockMovementById(id: string): Promise<StockMovementDto> {
  const currentUser = await requireOrganizationUser();
  const movement = await getStockMovementRecordById(id, currentUser.organizationId);
  if (!movement) throw new OperationsServiceError("Mouvement introuvable.", 404);
  return mapStockMovementToDto(movement);
}

export async function createStockAdjustment(
  input: StockAdjustmentInput,
): Promise<{ level: StockLevelDto; movement: StockMovementDto }> {
  const sessionUser = await requireOrganizationUser(["admin", "depot_manager"]);
  const parsed = stockAdjustmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  const movement = await applyStockMovement({
    ...parsed.data,
    organizationId: sessionUser.organizationId,
    createdByUserId: sessionUser.id,
  });
  return {
    level: await getStockLevel(parsed.data.productId, parsed.data.locationId),
    movement,
  };
}

export async function applyStockMovement(
  input: z.infer<typeof stockAdjustmentSchema> & { organizationId: string },
) {
  // Serializable so two concurrent adjustments on the same productId+locationId
  // can never both read the same current.quantity and silently overwrite one
  // another (Postgres aborts the losing transaction with P2034 instead) - the
  // retry below gives that losing transaction a chance to succeed on its own
  // once it re-reads the now-committed quantity, same pattern already used by
  // credit-notes.ts's withSerializableRetry.
  const movement = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const [product, location, user] = await Promise.all([
          tx.product.findFirst({
            where: { id: input.productId, organizationId: input.organizationId },
            select: { id: true },
          }),
          tx.stockLocation.findFirst({
            where: { id: input.locationId, organizationId: input.organizationId },
            select: {
              id: true,
              type: true,
              code: true,
              truckId: true,
            },
          }),
          tx.user.findFirst({
            where: input.createdByUserId
              ? { id: input.createdByUserId, organizationId: input.organizationId }
              : { role: "ADMIN", organizationId: input.organizationId },
            select: { id: true },
          }),
        ]);

        if (!product) throw new OperationsServiceError("Produit inexistant.", 422);
        if (!location) throw new OperationsServiceError("Emplacement inexistant.", 422);
        if (!user) throw new OperationsServiceError("Utilisateur responsable introuvable.", 422);

        if (location.type !== "TRUCK" && input.adjustmentMode === "SET") {
          throw new OperationsServiceError(
            "La modification par stock reel final est reservee au stock camion.",
            422,
            { locationId: "Selectionnez un emplacement camion." },
          );
        }

        if (location.type === "TRUCK" && location.truckId) {
          const activeTour = await tx.tour.findFirst({
            where: {
              organizationId: input.organizationId,
              truckId: location.truckId,
              status: "IN_PROGRESS",
            },
            select: { id: true, code: true },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
          });

          if (activeTour && !input.confirmActiveTour) {
            throw new OperationsServiceError(
              "Ce camion a une tournee en cours. Confirmez l'ajustement du stock pendant la tournee.",
              409,
              { confirmActiveTour: "Ce camion a une tournee en cours." },
            );
          }
        }

        const current = await tx.stockLevel.upsert({
          where: {
            productId_locationId: {
              productId: input.productId,
              locationId: input.locationId,
            },
          },
          update: {},
          create: {
            organizationId: input.organizationId,
            productId: input.productId,
            locationId: input.locationId,
            quantity: 0,
            reservedQuantity: 0,
          },
        });

        const nextQuantity =
          input.adjustmentMode === "SET"
            ? (input.targetQuantity ?? 0)
            : current.quantity + input.quantity;

        if (nextQuantity < 0) {
          throw new OperationsServiceError(
            "Le stock reel ne peut pas etre negatif.",
            422,
            { targetQuantity: "Le stock reel ne peut pas etre negatif." },
          );
        }

        const delta = nextQuantity - current.quantity;
        if (delta === 0) {
          throw new OperationsServiceError("Aucune modification de stock.", 409);
        }

        await tx.stockLevel.update({
          where: { id: current.id },
          data: { quantity: nextQuantity },
        });

        return tx.stockMovement.create({
          data: {
            organizationId: input.organizationId,
            movementNumber: await nextMovementNumber(tx, input.organizationId),
            type: "INVENTORY_ADJUSTMENT",
            productId: input.productId,
            quantity: Math.abs(delta),
            sourceLocationId: delta < 0 ? input.locationId : null,
            destinationLocationId: delta > 0 ? input.locationId : null,
            referenceType: "ADMIN_ADJUSTMENT",
            referenceId: input.reference || null,
            reason: input.reason,
            note: buildAdjustmentNote({
              note: input.note,
              beforeQuantity: current.quantity,
              afterQuantity: nextQuantity,
              deltaQuantity: delta,
            }),
            createdByUserId: user.id,
            status: "VALIDATED",
          },
          include: stockMovementInclude,
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );

  return mapStockMovementToDto(movement);
}

// Same pattern already used by credit-notes.ts / truck-loadings.ts /
// tours.ts / employees.ts / categories.ts etc.: each module keeps its own
// private copy rather than sharing one, so this mirrors that convention
// instead of introducing a new shared utility. Retries only P2034 (Postgres
// serialization failure under Serializable isolation) - any other error
// (validation, not-found, insufficient/negative stock) is rethrown
// immediately on the first attempt.
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
        (prismaError.code === "P2010" &&
          /40001|40P01/.test(prismaError.message ?? ""));
      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
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

  throw new OperationsServiceError("Impossible de finaliser l'ajustement de stock.", 500);
}

async function getStockMovementRecordById(id: string, organizationId: string) {
  return prisma.stockMovement.findFirst({
    where: { id, organizationId },
    include: stockMovementInclude,
  });
}

function resolveSignedQuantity(movement: NonNullable<MovementRecord>) {
  if (movement.destinationLocationId && !movement.sourceLocationId) {
    return movement.quantity;
  }
  if (movement.sourceLocationId && !movement.destinationLocationId) {
    return -movement.quantity;
  }
  return movement.quantity;
}

function buildAdjustmentNote({
  note,
  beforeQuantity,
  afterQuantity,
  deltaQuantity,
}: {
  note?: string | null;
  beforeQuantity: number;
  afterQuantity: number;
  deltaQuantity: number;
}) {
  const snapshot = JSON.stringify({
    beforeQuantity,
    afterQuantity,
    deltaQuantity,
  });
  const cleanedNote = note?.trim();
  return cleanedNote
    ? `ADJUSTMENT_SNAPSHOT:${snapshot}\n${cleanedNote}`
    : `ADJUSTMENT_SNAPSHOT:${snapshot}`;
}

function parseAdjustmentSnapshot(note: string | null) {
  if (!note?.startsWith("ADJUSTMENT_SNAPSHOT:")) {
    return {
      beforeQuantity: null,
      afterQuantity: null,
      deltaQuantity: null,
      cleanedNote: note,
    };
  }

  const [snapshotLine, ...rest] = note.split("\n");
  try {
    const snapshot = JSON.parse(
      snapshotLine.replace("ADJUSTMENT_SNAPSHOT:", ""),
    ) as {
      beforeQuantity?: number;
      afterQuantity?: number;
      deltaQuantity?: number;
    };

    return {
      beforeQuantity: snapshot.beforeQuantity ?? null,
      afterQuantity: snapshot.afterQuantity ?? null,
      deltaQuantity: snapshot.deltaQuantity ?? null,
      cleanedNote: rest.join("\n").trim() || null,
    };
  } catch {
    return {
      beforeQuantity: null,
      afterQuantity: null,
      deltaQuantity: null,
      cleanedNote: note,
    };
  }
}
