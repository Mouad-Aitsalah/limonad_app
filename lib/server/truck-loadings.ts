import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { TruckLoadingGetPayload } from "@/lib/generated/prisma/models/TruckLoading";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { nextMovementNumber } from "@/lib/server/sales-shared";
import type {
  TruckLoadingCreateInput,
  TruckLoadingDto,
  TruckLoadingEditInput,
  TruckLoadingHistoryPageDto,
  TruckLoadingListItemDto,
  TruckLoadingMutationInput,
  TruckLoadingValidationInput,
} from "@/types/operations-dto";

const loadingInclude = {
  depot: { select: { id: true, name: true } },
  truck: { select: { id: true, code: true } },
  driver: { select: { id: true, user: { select: { fullName: true } } } },
  tour: { select: { code: true } },
  createdBy: { select: { fullName: true } },
  validatedBy: { select: { fullName: true } },
  updatedBy: { select: { fullName: true } },
  lines: {
    include: {
      // barcode/unit (Phase 3 CRITICAL #1 fix): embedded on
      // TruckLoadingLineDto so an already-loaded line never depends on the
      // product picker's current preload/search results to render
      // correctly - see that type's doc comment.
      product: { select: { id: true, reference: true, name: true, barcode: true, unit: true } },
    },
    orderBy: { product: { name: "asc" } },
  },
} as const;
type TruckLoadingWithRelations = TruckLoadingGetPayload<{
  include: typeof loadingInclude;
}>;

export const truckLoadingMutationSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1, "Le produit est obligatoire."),
        initialQuantity: z.coerce
          .number()
          .int("La quantite doit etre un nombre entier.")
          .min(0, "La charge initiale ne peut pas etre negative."),
        reloadedQuantity: z.coerce
          .number()
          .int("La quantite doit etre un nombre entier.")
          .min(0, "La recharge ne peut pas etre negative."),
        // "Restante reelle" saved progressively on a still-open fiche. null /
        // omitted = not counted yet (a real 0 is kept as 0, never confused
        // with "empty"). Persisted so it survives refresh and feeds close.
        actualRemainingQuantity: z.coerce
          .number()
          .int("La quantite reelle doit etre un nombre entier.")
          .min(0, "La quantite reelle ne peut pas etre negative.")
          .nullish(),
      }),
    )
    .min(1, "Ajoutez au moins un produit."),
});

export const truckLoadingValidationSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1, "Le produit est obligatoire."),
        // Deliberately required (no default/optional): an omitted field means
        // the caller never counted this product, which must block validation
        // rather than silently becoming 0.
        actualRemainingQuantity: z.coerce
          .number()
          .int("La quantite reelle doit etre un nombre entier.")
          .min(0, "La quantite reelle ne peut pas etre negative."),
      }),
    )
    .default([]),
});

const truckLoadingEditSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1, "Le produit est obligatoire."),
        initialQuantity: z.coerce
          .number()
          .int("La quantite doit etre un nombre entier.")
          .min(0, "La charge initiale ne peut pas etre negative."),
        reloadedQuantity: z.coerce
          .number()
          .int("La quantite doit etre un nombre entier.")
          .min(0, "La recharge ne peut pas etre negative."),
        actualRemainingQuantity: z.coerce
          .number()
          .int("La quantite reelle doit etre un nombre entier.")
          .min(0, "La quantite reelle ne peut pas etre negative.")
          .nullish(),
      }),
    )
    .default([]),
});

type NormalizedLoadingLineInput = {
  productId: string;
  initialQuantity: number;
  reloadedQuantity: number;
  quantity: number;
  /** "Restante reelle" typed on a still-open fiche; null/omitted = not counted
   * yet (kept distinct from a real 0). Only the standalone /chargements save
   * path (validateLoadingLines -> updateOpenLoadingLines) carries it; the
   * stock-delta helpers ignore it. */
  actualRemainingQuantity?: number | null;
};

type PersistedLoadingLine = {
  productId: string;
  quantity: number;
  reloadedQuantity: number;
};

export async function mapTruckLoadingToDto(
  loading: TruckLoadingWithRelations,
): Promise<TruckLoadingDto> {
  const [depotLocation, truckLocation] = await Promise.all([
    prisma.stockLocation.findFirst({
      where: {
        organizationId: loading.organizationId,
        depotId: loading.depotId,
      },
      select: { id: true },
    }),
    prisma.stockLocation.findFirst({
      where: {
        organizationId: loading.organizationId,
        truckId: loading.truckId,
      },
      select: { id: true },
    }),
  ]);

  const productIds = loading.lines.map((line) => line.productId);
  const levels = await prisma.stockLevel.findMany({
    where: {
      organizationId: loading.organizationId,
      productId: { in: productIds },
      locationId: {
        in: [depotLocation?.id, truckLocation?.id].filter(
          (id): id is string => Boolean(id),
        ),
      },
    },
    select: { productId: true, locationId: true, quantity: true, reservedQuantity: true },
  });

  const transferAlreadyApplied =
    Boolean(loading.stockAppliedAt) || loading.status === "VALIDATED";

  return {
    id: loading.id,
    loadingNumber: loading.loadingNumber,
    displayNumber:
      loading.loadingYear !== null && loading.loadingSequence !== null
        ? `CHG/${loading.loadingSequence}/${loading.loadingYear}`
        : loading.loadingNumber,
    loadingYear: loading.loadingYear,
    loadingSequence: loading.loadingSequence,
    tourId: loading.tourId,
    tourCode: loading.tour?.code ?? null,
    driverId: loading.driverId,
    driverName: loading.driver.user.fullName,
    date: loading.date.toISOString(),
    depotId: loading.depotId,
    depotName: loading.depot.name,
    truckId: loading.truckId,
    truckCode: loading.truck.code,
    status: loading.status,
    stockAppliedAt: loading.stockAppliedAt?.toISOString() ?? null,
    validatedAt: loading.validatedAt?.toISOString() ?? null,
    closedAt: loading.status === "VALIDATED" ? loading.validatedAt?.toISOString() ?? null : null,
    validatedByUserName: loading.validatedBy?.fullName ?? null,
    createdByUserName: loading.createdBy.fullName,
    updatedByUserName: loading.updatedBy?.fullName ?? null,
    lines: loading.lines.map((line) => {
      const initialQuantity = Math.max(0, line.quantity - line.reloadedQuantity);
      const depotLevel = levels.find(
        (level) =>
          level.productId === line.productId && level.locationId === depotLocation?.id,
      );
      const truckLevel = levels.find(
        (level) =>
          level.productId === line.productId && level.locationId === truckLocation?.id,
      );
      const depotAvailableQuantity =
        (depotLevel?.quantity ?? 0) - (depotLevel?.reservedQuantity ?? 0);
      const truckCurrentQuantity = truckLevel?.quantity ?? 0;

      return {
        id: line.id,
        productId: line.productId,
        productReference: line.product.reference,
        productName: line.product.name,
        productBarcode: line.product.barcode,
        productUnit: line.product.unit,
        quantity: line.quantity,
        initialQuantity,
        reloadedQuantity: line.reloadedQuantity,
        depotAvailableQuantity,
        truckCurrentQuantity,
        depotAfterLoading: transferAlreadyApplied
          ? depotAvailableQuantity
          : depotAvailableQuantity - line.quantity,
        truckAfterLoading: transferAlreadyApplied
          ? truckCurrentQuantity
          : truckCurrentQuantity + line.quantity,
        theoreticalRemainingQuantity: line.theoreticalRemainingQuantity,
        actualRemainingQuantity: line.actualRemainingQuantity,
      };
    }),
    createdAt: loading.createdAt.toISOString(),
    updatedAt: loading.updatedAt.toISOString(),
  };
}

export async function getLoadingByTourId(
  tourId: string,
  organizationId?: string,
): Promise<TruckLoadingDto | null> {
  const resolvedOrganizationId =
    organizationId ??
    (
      await requireOrganizationUser(["admin", "depot_manager", "cashier", "driver"])
    ).organizationId;
  const loading = await getLoadingRecordByTourId(tourId, resolvedOrganizationId);
  return loading ? mapTruckLoadingToDto(loading) : null;
}

// ---------------------------------------------------------------------------
// Standalone ("chargement != tournee") API used by /chargements. A fiche is
// identified purely by truckId + status: OPEN (DRAFT) means active, CLOSED
// (VALIDATED) means archived. Nothing here ever reads or writes a Tour.
// ---------------------------------------------------------------------------

const truckLoadingCreateSchema = z.object({
  truckId: z.string().trim().min(1, "Le camion est obligatoire."),
  driverId: z.string().trim().min(1, "Le chauffeur est obligatoire."),
  date: z.coerce.date(),
});

export async function getOpenLoadingForTruck(truckId: string): Promise<TruckLoadingDto | null> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager"]);
  const loading = await prisma.truckLoading.findFirst({
    where: {
      organizationId: currentUser.organizationId,
      truckId,
      status: "DRAFT",
    },
    include: loadingInclude,
    orderBy: { createdAt: "desc" },
  });
  return loading ? mapTruckLoadingToDto(loading) : null;
}

/**
 * The truck's loading currently available to back a NEW tour: not yet
 * claimed by any tour (tourId: null), with stock actually applied
 * (stockAppliedAt set - a bare fiche with no lines yet has nothing to
 * drive with), and not cancelled. DRAFT (still open at the depot/admin
 * level) or VALIDATED (already closed/reconciled) are both eligible -
 * mirrors the driver tour-start rule that existed before TruckLoading was
 * decoupled from Tour (see the "decouple_truck_loading_from_tour"
 * migration): either state was always enough to drive.
 *
 * This is the bridge between the two independently-evolved systems: admins
 * keep managing loadings entirely through /chargements (truckId + status,
 * never touching Tour - see the module doc above), while a driver starting
 * a tour claims whichever one of the truck's loadings hasn't been claimed
 * yet (lib/server/tours.ts#claimLoadingAndStartTour). Once claimed
 * (tourId set), a loading can never be claimed again by a different tour,
 * which is exactly what keeps each tour's stock bilan (charge/rechargee/
 * vendue/restante) from ever mixing with another tour's.
 *
 * Takes a transaction client so callers can claim the result atomically
 * within the same transaction that creates/starts the tour.
 */
export async function getClaimableLoadingForTruck(
  tx: Pick<typeof prisma, "truckLoading">,
  organizationId: string,
  truckId: string,
): Promise<{ id: string; status: string } | null> {
  return tx.truckLoading.findFirst({
    where: {
      organizationId,
      truckId,
      tourId: null,
      stockAppliedAt: { not: null },
      status: { in: ["DRAFT", "VALIDATED"] },
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "desc" },
  });
}

const HISTORY_DEFAULT_PAGE_SIZE = 25;
const HISTORY_MAX_PAGE_SIZE = 100;

// Exactly the fields the history table renders (see the
// TruckLoadingListItemDto doc comment) - never a line's product join or
// stock computation, which every row would otherwise need mapTruckLoadingToDto
// to compute (2 stockLocation lookups + 1 stockLevel batch read PER ROW,
// none of which the table displays). `lines: { select: { quantity: true } }`
// is the one per-row relation still fetched, purely to derive linesCount/
// totalQuantity in memory - a plain int per line, not the heavier lines
// select (product join, all the stock fields) mapTruckLoadingToDto uses.
const loadingListSelect = {
  id: true,
  loadingNumber: true,
  loadingYear: true,
  loadingSequence: true,
  date: true,
  status: true,
  validatedAt: true,
  createdAt: true,
  tour: { select: { code: true } },
  driver: { select: { user: { select: { fullName: true } } } },
  truck: { select: { code: true } },
  depot: { select: { name: true } },
  lines: { select: { quantity: true } },
} as const;

function mapLoadingRowToListItemDto(
  loading: TruckLoadingGetPayload<{ select: typeof loadingListSelect }>,
): TruckLoadingListItemDto {
  return {
    id: loading.id,
    loadingNumber: loading.loadingNumber,
    displayNumber:
      loading.loadingYear !== null && loading.loadingSequence !== null
        ? `CHG/${loading.loadingSequence}/${loading.loadingYear}`
        : loading.loadingNumber,
    loadingYear: loading.loadingYear,
    loadingSequence: loading.loadingSequence,
    tourCode: loading.tour?.code ?? null,
    driverName: loading.driver.user.fullName,
    date: loading.date.toISOString(),
    depotName: loading.depot.name,
    truckCode: loading.truck.code,
    status: loading.status,
    linesCount: loading.lines.length,
    totalQuantity: loading.lines.reduce((sum, line) => sum + line.quantity, 0),
    createdAt: loading.createdAt.toISOString(),
    closedAt: loading.status === "VALIDATED" ? (loading.validatedAt?.toISOString() ?? null) : null,
  };
}

/**
 * Phase 3 rewrite of what used to be getLoadingHistory(): the original did
 * ONE findMany (already batched, not N+1 by itself) then
 * Promise.all(loadings.map(mapTruckLoadingToDto)) - 3 extra queries PER
 * ROW (2 stockLocation lookups + 1 stockLevel batch read), all spent
 * computing per-line stock numbers the history table never displays (see
 * the Phase 3-A audit). This version selects only what the table actually
 * renders in one query, with server-side cursor pagination so the number
 * of rows read never grows unbounded with history size either.
 *
 * Cursor: `id`, paired with `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`
 * for a fully deterministic order (ties on createdAt broken by id) - see
 * the id tie-breaker requirement in the Phase 3 spec. loadingYear/
 * loadingSequence (the original sort) are assigned once, at creation,
 * strictly in createdAt order (see nextLoadingSequence) - createdAt desc
 * alone reproduces the exact same effective order for all real data, and
 * unlike a 3-key sort gives a single, unambiguous keyset column pair Prisma
 * cursor pagination is known to handle correctly.
 */
export async function getLoadingHistoryPage(
  params: { cursor?: string | null; pageSize?: number } = {},
): Promise<TruckLoadingHistoryPageDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager"]);
  const requestedPageSize = Math.trunc(params.pageSize ?? HISTORY_DEFAULT_PAGE_SIZE);
  // Never let a caller ask for an unbounded page (see the Phase 3 spec's
  // explicit "never pageSize=100000") - clamped both ends, invalid/absent
  // input silently falls back to the default rather than erroring.
  const pageSize =
    Number.isFinite(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, HISTORY_MAX_PAGE_SIZE)
      : HISTORY_DEFAULT_PAGE_SIZE;

  const [rows, totalCount] = await Promise.all([
    prisma.truckLoading.findMany({
      where: { organizationId: currentUser.organizationId },
      select: loadingListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // +1: fetched but not returned, purely to know whether a next page
      // exists without a separate count query per request.
      take: pageSize + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    // Scoped by the same indexed organizationId every other org-scoped
    // count in this app uses - O(1) round trip, cost grows with matching
    // rows (same characteristic already documented for nextMovementNumber
    // in the Phase 3-A audit), not with page size.
    prisma.truckLoading.count({ where: { organizationId: currentUser.organizationId } }),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    items: pageRows.map(mapLoadingRowToListItemDto),
    nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    hasMore,
    totalCount,
  };
}

export async function getLoadingById(id: string): Promise<TruckLoadingDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager"]);
  const loading = await prisma.truckLoading.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    include: loadingInclude,
  });
  if (!loading) throw new OperationsServiceError("Chargement introuvable.", 404);
  return mapTruckLoadingToDto(loading);
}

/**
 * Creates a new OPEN fiche for a truck, or - if one is already open for that
 * truck - simply returns it instead of erroring (see item 7 of the spec: a
 * truck already having an open fiche is not an error, it just means "resume
 * that one"). Never looks at, creates, or requires a Tour of any status.
 */
/**
 * A driver's "usual" products = the distinct products of their most recent
 * CLOSED (VALIDATED) fiche de chargement. Scoped to organizationId + driverId
 * (never truck, never org-wide - spec item 1: no cross-driver bleed). The
 * last fiche is implicitly the template for the next one, so an item removed
 * last time is simply absent here (item 2/6). Products no longer ACTIVE in
 * this organisation are dropped and never reactivated (item 9). Returns []
 * for a driver who has never had a closed fiche (item 5).
 */
async function resolveDriverUsualProductIds(
  tx: Pick<typeof prisma, "truckLoading" | "product">,
  organizationId: string,
  driverId: string,
): Promise<string[]> {
  const lastClosed = await tx.truckLoading.findFirst({
    where: { organizationId, driverId, status: "VALIDATED" },
    orderBy: [{ validatedAt: "desc" }, { createdAt: "desc" }],
    select: { lines: { select: { productId: true } } },
  });
  if (!lastClosed || lastClosed.lines.length === 0) return [];

  const productIds = [...new Set(lastClosed.lines.map((line) => line.productId))];
  const activeProducts = await tx.product.findMany({
    where: { id: { in: productIds }, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  return activeProducts.map((product) => product.id);
}

export async function createOrReuseOpenLoading(
  input: TruckLoadingCreateInput,
): Promise<{ loading: TruckLoadingDto; reused: boolean }> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const parsed = truckLoadingCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const result = await withLoadingSerializableRetry(async () => {
    return prisma.$transaction(
      async (tx) => {
        const existingOpen = await tx.truckLoading.findFirst({
          where: {
            organizationId: user.organizationId,
            truckId: parsed.data.truckId,
            status: "DRAFT",
          },
          include: loadingInclude,
        });
        if (existingOpen) {
          return { loading: existingOpen, reused: true };
        }

        const truck = await tx.truck.findFirst({
          where: {
            id: parsed.data.truckId,
            organizationId: user.organizationId,
          },
          select: { id: true, depotId: true, status: true },
        });
        if (!truck) throw new OperationsServiceError("Camion introuvable.", 404);
        if (truck.status === "INACTIVE") {
          throw new OperationsServiceError("Le camion est inactif.", 422);
        }

        const driver = await tx.driver.findFirst({
          where: {
            id: parsed.data.driverId,
            organizationId: user.organizationId,
          },
          select: { id: true, active: true },
        });
        if (!driver?.active) {
          throw new OperationsServiceError("Chauffeur introuvable ou inactif.", 404);
        }

        const { year, sequence } = await nextLoadingSequence(tx, user.organizationId);

        // Prefill the fresh fiche with this driver's usual products,
        // quantities reset to 0. A pre-shown line is UI-only: it removes no
        // depot stock, adds no truck stock and records no StockMovement -
        // charge initiale / rechargee still apply exactly as before, only
        // once a real quantity is saved/closed through the normal flow
        // (items 3 & 4). Never runs on the reused-open-fiche path above.
        const prefillProductIds = await resolveDriverUsualProductIds(
          tx,
          user.organizationId,
          driver.id,
        );

        const created = await tx.truckLoading.create({
          data: {
            organizationId: user.organizationId,
            loadingNumber: `CHG/${sequence}/${year}`,
            loadingYear: year,
            loadingSequence: sequence,
            tourId: null,
            driverId: driver.id,
            date: parsed.data.date,
            depotId: truck.depotId,
            truckId: truck.id,
            createdByUserId: user.id,
            ...(prefillProductIds.length > 0
              ? {
                  lines: {
                    create: prefillProductIds.map((productId) => ({
                      productId,
                      quantity: 0,
                      reloadedQuantity: 0,
                    })),
                  },
                }
              : {}),
          },
          include: loadingInclude,
        });
        return { loading: created, reused: false };
      },
      // 15s: several sequential round-trips per transaction can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    );
  });

  return { loading: await mapTruckLoadingToDto(result.loading), reused: result.reused };
}

/**
 * Autosaves the lines of an OPEN fiche as the user types, progressively
 * (see item 9 of the spec: closing must never be the first time data is
 * persisted). Reuses the same stock-delta application as the tour-scoped
 * updateDraftLoading below - a redraw of the page never re-applies a
 * transfer, only the delta between what was previously applied and the new
 * totals is moved.
 */
export async function updateOpenLoadingLines(
  loadingId: string,
  input: TruckLoadingMutationInput,
): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const lines = validateLoadingLines(input, { allowZeroTotalLines: true });

  // F10: read-then-write on a single row already looked up by id inside the
  // transaction, so a retry after a Serializable conflict (P2034) simply
  // re-reads the fresh current state and re-applies the same delta - never
  // a double-apply. Reuses withLoadingSerializableRetry, already defined in
  // this file (see createOrReuseOpenLoading above).
  const loading = await withLoadingSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const current = await tx.truckLoading.findFirst({
          where: {
            id: loadingId,
            organizationId: user.organizationId,
          },
          select: {
            id: true,
            loadingNumber: true,
            depotId: true,
            truckId: true,
            status: true,
            stockAppliedAt: true,
            lines: {
              select: { productId: true, quantity: true, reloadedQuantity: true },
            },
          },
        });
        if (!current) throw new OperationsServiceError("Chargement introuvable.", 404);
        if (current.status !== "DRAFT") {
          throw new OperationsServiceError("Ce chargement est ferme et n'est plus modifiable.", 409);
        }

        await assertProductsExist(tx, lines.map((line) => line.productId), user.organizationId);

        const { depotLocationId, truckLocationId } = await resolveLoadingLocationIds(
          tx,
          user.organizationId,
          current.depotId,
          current.truckId,
        );

        await applyLoadingStockDelta(tx, {
          loadingId: current.id,
          loadingNumber: current.loadingNumber,
          depotLocationId,
          truckLocationId,
          previousLines: current.lines,
          nextLines: lines,
          stockAlreadyApplied: Boolean(current.stockAppliedAt),
          organizationId: user.organizationId,
          userId: user.id,
        });

        await tx.truckLoadingLine.deleteMany({ where: { loadingId: current.id } });
        await tx.truckLoadingLine.createMany({
          data: lines.map((line) => ({
            loadingId: current.id,
            productId: line.productId,
            quantity: line.quantity,
            reloadedQuantity: line.reloadedQuantity,
            // BUG FIX: the "Restante reelle" typed on the draft was dropped
            // here (recreate omitted it), so every save reset it to null.
            // Persist it now - a real 0 stays 0, "not counted" stays null.
            actualRemainingQuantity: line.actualRemainingQuantity ?? null,
          })),
        });

        return tx.truckLoading.update({
          where: { id: current.id },
          data: { stockAppliedAt: current.stockAppliedAt ?? new Date() },
          include: loadingInclude,
        });
      },
      // 15s: several sequential round-trips per transaction can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapTruckLoadingToDto(loading);
}

/**
 * "Fermer le chargement": persists the final lines (theoretical + real
 * counted quantity, directly on TruckLoadingLine so this never depends on a
 * Tour existing), sets the truck's official StockLevel to the counted
 * quantity, records an INVENTORY_ADJUSTMENT movement only when there is an
 * actual gap, then flips the fiche OPEN -> CLOSED with closedAt. A
 * second call on an already-closed fiche is rejected, never re-applied.
 */
export async function closeLoading(
  loadingId: string,
  input: TruckLoadingValidationInput,
): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const parsed = truckLoadingValidationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }
  const providedByProductId = new Map(
    parsed.data.lines.map((line) => [line.productId, line.actualRemainingQuantity]),
  );

  // F10: re-checks current.status fresh on every attempt (DRAFT vs
  // VALIDATED) before doing anything else, so a retry after a Serializable
  // conflict either safely re-runs the same close on a still-DRAFT loading,
  // or - if the other concurrent request's close already committed -
  // cleanly hits the "Ce chargement est deja ferme." 409 below instead of
  // double-applying the stock adjustment. Reuses withLoadingSerializableRetry
  // (see createOrReuseOpenLoading above).
  const loading = await withLoadingSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const current = await tx.truckLoading.findFirst({
        where: {
          id: loadingId,
          organizationId: user.organizationId,
        },
        select: {
          id: true,
          loadingNumber: true,
          depotId: true,
          truckId: true,
          status: true,
          stockAppliedAt: true,
          lines: {
            select: { productId: true, quantity: true, reloadedQuantity: true },
          },
        },
      });
      if (!current) throw new OperationsServiceError("Chargement introuvable.", 404);
      if (current.status === "VALIDATED") {
        throw new OperationsServiceError("Ce chargement est deja ferme.", 409);
      }
      if (current.status !== "DRAFT") {
        throw new OperationsServiceError("Chargement annule, fermeture impossible.", 409);
      }
      if (current.lines.length === 0) {
        throw new OperationsServiceError("Ajoutez au moins un produit.", 422);
      }

      const { depotLocationId, truckLocationId } = await resolveLoadingLocationIds(
        tx,
        user.organizationId,
        current.depotId,
        current.truckId,
      );

      // Charge initiale / rechargee are applied to StockLevel as soon as the
      // draft is saved - never a second time here. Safety net only, for a
      // fiche that was somehow closed without ever going through a save.
      if (!current.stockAppliedAt) {
        await applyLoadingStockDelta(tx, {
          loadingId: current.id,
          loadingNumber: current.loadingNumber,
          depotLocationId,
          truckLocationId,
          previousLines: [],
          nextLines: current.lines.map((line) => ({
            productId: line.productId,
            initialQuantity: Math.max(0, line.quantity - line.reloadedQuantity),
            reloadedQuantity: line.reloadedQuantity,
            quantity: line.quantity,
          })),
          stockAlreadyApplied: false,
          organizationId: user.organizationId,
          userId: user.id,
        });

        await tx.truckLoading.update({
          where: { id: current.id },
          data: { stockAppliedAt: new Date() },
        });
      }

      const stockedProductIds = await tx.stockLevel.findMany({
        where: {
          organizationId: user.organizationId,
          locationId: truckLocationId,
          quantity: { gt: 0 },
        },
        select: { productId: true },
      });
      const requiredProductIds = new Set([
        ...current.lines.map((line) => line.productId),
        ...stockedProductIds.map((level) => level.productId),
      ]);
      const missingProductIds = [...requiredProductIds].filter(
        (productId) => !providedByProductId.has(productId),
      );
      if (missingProductIds.length > 0) {
        throw new OperationsServiceError(
          "Veuillez saisir la quantite restante reelle pour tous les produits.",
          422,
          Object.fromEntries(
            missingProductIds.map((productId) => [
              productId,
              "Quantite restante reelle manquante.",
            ]),
          ),
        );
      }

      await applyActualRemainingQuantitiesOnLine(tx, {
        loadingId: current.id,
        loadingNumber: current.loadingNumber,
        truckLocationId,
        organizationId: user.organizationId,
        lines: parsed.data.lines,
        userId: user.id,
      });

      return tx.truckLoading.update({
        where: { id: current.id },
        data: {
          status: "VALIDATED",
          validatedAt: new Date(),
          validatedByUserId: user.id,
        },
        include: loadingInclude,
      });
      },
      // 15s: several sequential round-trips per transaction can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapTruckLoadingToDto(loading);
}

/**
 * General-purpose edit of a fiche's product lines from the /chargements/[id]
 * detail view - works for both an OPEN (DRAFT) and a CLOSED (VALIDATED)
 * fiche, and is what makes "modifier une fiche fermee" possible without ever
 * duplicating a stock movement:
 *
 *  - Charge initiale / rechargee: applyLoadingStockDelta already only ever
 *    moves the DIFFERENCE between what is currently persisted on each line
 *    and what is submitted (see its own doc above) - reused unchanged here,
 *    so editing 20 -> 25 moves +5, never re-creates +25, whether the fiche
 *    is open or already closed.
 *  - Restante reelle (closed fiches only, where it is the source of truth
 *    for StockLevel): reusing applyActualRemainingQuantitiesOnLine is safe
 *    to call again after an initial close, because it always compares the
 *    new value against the CURRENT live StockLevel (which already reflects
 *    any prior correction) - so a second edit only ever applies the
 *    incremental difference, never re-applies the full amount.
 *  - A line omitted from the submitted set is removed: its full quantity is
 *    reversed depot<-truck by applyLoadingStockDelta, which itself refuses
 *    the removal (409) if the truck no longer has enough stock to reverse
 *    (e.g. some of it was already sold) - so a line tied to stock that can
 *    no longer be safely moved back is protected, not silently deleted.
 */
export async function updateLoadingLines(
  loadingId: string,
  input: TruckLoadingEditInput,
): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const parsed = truckLoadingEditSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const seen = new Set<string>();
  for (const line of parsed.data.lines) {
    if (seen.has(line.productId)) {
      throw new OperationsServiceError(
        "Ce produit existe deja dans ce chargement.",
        422,
        { [line.productId]: "Ce produit existe deja dans ce chargement." },
      );
    }
    seen.add(line.productId);
  }

  // F10: read-then-write on a single row already looked up by id, so a
  // retry after a Serializable conflict (P2034) simply re-reads fresh
  // state and re-applies the same delta - reuses withLoadingSerializableRetry
  // (see createOrReuseOpenLoading above).
  const loading = await withLoadingSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const current = await tx.truckLoading.findFirst({
        where: {
          id: loadingId,
          organizationId: user.organizationId,
        },
        select: {
          id: true,
          loadingNumber: true,
          depotId: true,
          truckId: true,
          status: true,
          stockAppliedAt: true,
          lines: {
            select: { productId: true, quantity: true, reloadedQuantity: true },
          },
        },
      });
      if (!current) throw new OperationsServiceError("Chargement introuvable.", 404);
      if (current.status === "CANCELLED") {
        throw new OperationsServiceError("Chargement annule, modification impossible.", 409);
      }

      await assertProductsExist(
        tx,
        parsed.data.lines.map((line) => line.productId),
        user.organizationId,
      );

      if (current.status === "VALIDATED") {
        const missingProductIds = parsed.data.lines
          .filter((line) => line.actualRemainingQuantity == null)
          .map((line) => line.productId);
        if (missingProductIds.length > 0) {
          throw new OperationsServiceError(
            "Veuillez saisir la quantite restante reelle pour tous les produits.",
            422,
            Object.fromEntries(
              missingProductIds.map((productId) => [
                productId,
                "Quantite restante reelle manquante.",
              ]),
            ),
          );
        }
      }

      const { depotLocationId, truckLocationId } = await resolveLoadingLocationIds(
        tx,
        user.organizationId,
        current.depotId,
        current.truckId,
      );

      const nextLines: NormalizedLoadingLineInput[] = parsed.data.lines.map((line) => ({
        productId: line.productId,
        initialQuantity: line.initialQuantity,
        reloadedQuantity: line.reloadedQuantity,
        quantity: line.initialQuantity + line.reloadedQuantity,
      }));

      await applyLoadingStockDelta(tx, {
        loadingId: current.id,
        loadingNumber: current.loadingNumber,
        depotLocationId,
        truckLocationId,
        previousLines: current.lines,
        nextLines,
        stockAlreadyApplied: Boolean(current.stockAppliedAt),
        organizationId: user.organizationId,
        userId: user.id,
      });

      await tx.truckLoadingLine.deleteMany({ where: { loadingId: current.id } });
      await tx.truckLoadingLine.createMany({
        data: nextLines.map((line) => ({
          loadingId: current.id,
          productId: line.productId,
          quantity: line.quantity,
          reloadedQuantity: line.reloadedQuantity,
        })),
      });

      if (current.status === "VALIDATED") {
        await applyActualRemainingQuantitiesOnLine(tx, {
          loadingId: current.id,
          loadingNumber: current.loadingNumber,
          truckLocationId,
          organizationId: user.organizationId,
          lines: parsed.data.lines.map((line) => ({
            productId: line.productId,
            actualRemainingQuantity: line.actualRemainingQuantity as number,
          })),
          userId: user.id,
        });
      } else {
        for (const line of parsed.data.lines) {
          if (line.actualRemainingQuantity == null) continue;
          await tx.truckLoadingLine.update({
            where: {
              loadingId_productId: { loadingId: current.id, productId: line.productId },
            },
            data: { actualRemainingQuantity: line.actualRemainingQuantity },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: "TRUCK_LOADING_LINES_UPDATED",
          entityType: "TruckLoading",
          entityId: current.id,
          oldValue: { lines: current.lines },
          newValue: { lines: parsed.data.lines },
        },
      });

      return tx.truckLoading.update({
        where: { id: current.id },
        data: { updatedByUserId: user.id },
        include: loadingInclude,
      });
      },
      // 15s: several sequential round-trips per transaction can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapTruckLoadingToDto(loading);
}

async function applyActualRemainingQuantitiesOnLine(
  tx: Pick<typeof prisma, "stockLevel" | "stockMovement" | "truckLoadingLine" | "$queryRaw">,
  input: {
    loadingId: string;
    loadingNumber: string;
    truckLocationId: string;
    organizationId: string;
    lines: { productId: string; actualRemainingQuantity: number }[];
    userId: string;
  },
) {
  for (const line of input.lines) {
    const level = await tx.stockLevel.findUnique({
      where: {
        productId_locationId: { productId: line.productId, locationId: input.truckLocationId },
      },
      select: { id: true, quantity: true },
    });

    const theoreticalQuantity = level?.quantity ?? 0;
    const actualQuantity = line.actualRemainingQuantity;
    const difference = actualQuantity - theoreticalQuantity;

    if (difference !== 0) {
      await tx.stockLevel.upsert({
        where: {
          productId_locationId: { productId: line.productId, locationId: input.truckLocationId },
        },
        update: { quantity: actualQuantity },
        create: {
          organizationId: input.organizationId,
          productId: line.productId,
          locationId: input.truckLocationId,
          quantity: actualQuantity,
          reservedQuantity: 0,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: input.organizationId,
          movementNumber: await nextMovementNumber(tx, input.organizationId),
          type: "INVENTORY_ADJUSTMENT",
          productId: line.productId,
          quantity: Math.abs(difference),
          sourceLocationId: difference < 0 ? input.truckLocationId : null,
          destinationLocationId: difference > 0 ? input.truckLocationId : null,
          referenceType: "TRUCK_LOADING",
          referenceId: input.loadingId,
          reason: "Cloture chargement - ajustement stock reel",
          note: JSON.stringify({
            loadingNumber: input.loadingNumber,
            theoreticalQuantity,
            actualQuantity,
            difference,
          }),
          createdByUserId: input.userId,
          status: "VALIDATED",
        },
      });
    }

    // Every product with truck stock must be counted to close (see the
    // missingProductIds check above), but not all of them are necessarily a
    // line on THIS fiche - a product already on the truck from a previous
    // loading, never re-charged/reloaded here, has no TruckLoadingLine row
    // yet. Upsert (not update) so counting it doesn't throw P2025; a newly
    // created line correctly shows quantity/reloadedQuantity 0, since this
    // fiche never loaded it.
    await tx.truckLoadingLine.upsert({
      where: {
        loadingId_productId: { loadingId: input.loadingId, productId: line.productId },
      },
      update: {
        theoreticalRemainingQuantity: theoreticalQuantity,
        actualRemainingQuantity: actualQuantity,
      },
      create: {
        loadingId: input.loadingId,
        productId: line.productId,
        quantity: 0,
        reloadedQuantity: 0,
        theoreticalRemainingQuantity: theoreticalQuantity,
        actualRemainingQuantity: actualQuantity,
      },
    });
  }
}

async function nextLoadingSequence(
  tx: Pick<typeof prisma, "truckLoading" | "$queryRaw">,
  organizationId: string,
) {
  const year = new Date().getFullYear();
  const sequence = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.LoadingSequence,
    String(year),
  );
  return { year, sequence };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLoadingSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 40,
): Promise<T> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string; message?: string };
      attempt += 1;
      const isRetryable =
        ["P2002", "P2034"].includes(prismaError.code ?? "") ||
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
  throw new OperationsServiceError("Impossible de creer le chargement.", 500);
}

export async function createLoading(
  tourId: string,
  input: TruckLoadingMutationInput,
): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const lines = validateLoadingLines(input);

  // F10: idempotent by construction - tour.loading is re-checked fresh on
  // every attempt, so a retry after a Serializable conflict either safely
  // creates the loading (if the other request hasn't committed yet) or
  // cleanly hits the "deja un chargement" 409 (if it has) - never a
  // duplicate. Reuses withLoadingSerializableRetry (see
  // createOrReuseOpenLoading above).
  const loading = await withLoadingSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const tour = await tx.tour.findFirst({
        where: {
          id: tourId,
          organizationId: user.organizationId,
        },
        select: {
          id: true,
          depotId: true,
          truckId: true,
          driverId: true,
          date: true,
          status: true,
          loading: { select: { id: true, status: true } },
        },
      });
      if (!tour) throw new OperationsServiceError("Tournee introuvable.", 404);
      if (!["DRAFT", "PREPARED"].includes(tour.status)) {
        throw new OperationsServiceError("Statut de tournee incompatible.", 409);
      }
      if (tour.loading) {
        throw new OperationsServiceError("Cette tournee possede deja un chargement.", 409);
      }

      await assertProductsExist(tx, lines.map((line) => line.productId), user.organizationId);

      const created = await tx.truckLoading.create({
        data: {
          organizationId: user.organizationId,
          loadingNumber: await nextLoadingNumber(tx, user.organizationId),
          tourId: tour.id,
          depotId: tour.depotId,
          truckId: tour.truckId,
          driverId: tour.driverId,
          date: tour.date,
          createdByUserId: user.id,
        },
      });

      const { depotLocationId, truckLocationId } = await resolveLoadingLocationIds(
        tx,
        user.organizationId,
        created.depotId,
        created.truckId,
      );

      await applyLoadingStockDelta(tx, {
        loadingId: created.id,
        loadingNumber: created.loadingNumber,
        depotLocationId,
        truckLocationId,
        previousLines: [],
        nextLines: lines,
        stockAlreadyApplied: false,
        organizationId: user.organizationId,
        userId: user.id,
      });

      await tx.truckLoadingLine.createMany({
        data: lines.map((line) => ({
          loadingId: created.id,
          productId: line.productId,
          quantity: line.quantity,
          reloadedQuantity: line.reloadedQuantity,
        })),
      });

      return tx.truckLoading.update({
        where: { id: created.id },
        data: { stockAppliedAt: new Date() },
        include: loadingInclude,
      });
      },
      // 15s: several sequential round-trips per transaction can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapTruckLoadingToDto(loading);
}

export async function updateDraftLoading(
  tourId: string,
  input: TruckLoadingMutationInput,
): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const lines = validateLoadingLines(input);

  // F10: read-then-write on a single row already looked up by tourId, so a
  // retry after a Serializable conflict (P2034) simply re-reads fresh state
  // and re-applies the same delta - reuses withLoadingSerializableRetry
  // (see createOrReuseOpenLoading above).
  const loading = await withLoadingSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const current = await tx.truckLoading.findFirst({
        where: {
          tourId,
          organizationId: user.organizationId,
        },
        select: {
          id: true,
          loadingNumber: true,
          depotId: true,
          truckId: true,
          status: true,
          stockAppliedAt: true,
          lines: {
            select: {
              productId: true,
              quantity: true,
              reloadedQuantity: true,
            },
          },
        },
      });
      if (!current) throw new OperationsServiceError("Chargement introuvable.", 404);
      if (current.status !== "DRAFT") {
        throw new OperationsServiceError("Un chargement valide est en lecture seule.", 409);
      }

      await assertProductsExist(tx, lines.map((line) => line.productId), user.organizationId);

      const { depotLocationId, truckLocationId } = await resolveLoadingLocationIds(
        tx,
        user.organizationId,
        current.depotId,
        current.truckId,
      );

      await applyLoadingStockDelta(tx, {
        loadingId: current.id,
        loadingNumber: current.loadingNumber,
        depotLocationId,
        truckLocationId,
        previousLines: current.lines,
        nextLines: lines,
        stockAlreadyApplied: Boolean(current.stockAppliedAt),
        organizationId: user.organizationId,
        userId: user.id,
      });

      await tx.truckLoadingLine.deleteMany({ where: { loadingId: current.id } });
      await tx.truckLoadingLine.createMany({
        data: lines.map((line) => ({
          loadingId: current.id,
          productId: line.productId,
          quantity: line.quantity,
          reloadedQuantity: line.reloadedQuantity,
        })),
      });

      return tx.truckLoading.update({
        where: { id: current.id },
        data: {
          stockAppliedAt: current.stockAppliedAt ?? new Date(),
        },
        include: loadingInclude,
      });
      },
      // 15s: several sequential round-trips per transaction can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapTruckLoadingToDto(loading);
}

export async function cancelDraftLoading(tourId: string): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  // F10: current.status is re-checked fresh on every attempt, so a retry
  // after a Serializable conflict either safely cancels (if still DRAFT) or
  // cleanly hits the 409 below (if a concurrent request already cancelled
  // or validated it) - never a double stock reversal. Reuses
  // withLoadingSerializableRetry (see createOrReuseOpenLoading above).
  const loading = await withLoadingSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const current = await tx.truckLoading.findFirst({
        where: {
          tourId,
          organizationId: user.organizationId,
        },
        select: {
          id: true,
          loadingNumber: true,
          depotId: true,
          truckId: true,
          status: true,
          stockAppliedAt: true,
          lines: {
            select: {
              productId: true,
              quantity: true,
              reloadedQuantity: true,
            },
          },
        },
      });
      if (!current) throw new OperationsServiceError("Chargement introuvable.", 404);
      if (current.status !== "DRAFT") {
        throw new OperationsServiceError("Un chargement valide ne peut pas etre annule.", 409);
      }

      if (current.stockAppliedAt) {
        const { depotLocationId, truckLocationId } = await resolveLoadingLocationIds(
          tx,
          user.organizationId,
          current.depotId,
          current.truckId,
        );

        await applyLoadingStockDelta(tx, {
          loadingId: current.id,
          loadingNumber: current.loadingNumber,
          depotLocationId,
          truckLocationId,
          previousLines: current.lines,
          nextLines: [],
          stockAlreadyApplied: true,
          organizationId: user.organizationId,
          userId: user.id,
        });
      }

      return tx.truckLoading.update({
        where: { id: current.id },
        data: { status: "CANCELLED" },
        include: loadingInclude,
      });
      },
      // 15s: several sequential round-trips per transaction can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapTruckLoadingToDto(loading);
}

export async function validateLoading(
  tourId: string,
  input: TruckLoadingValidationInput,
): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const parsed = truckLoadingValidationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }
  const providedByProductId = new Map(
    parsed.data.lines.map((line) => [line.productId, line.actualRemainingQuantity]),
  );

  // F10: re-checks current.status fresh on every attempt (like closeLoading
  // above, the tour-scoped equivalent of the same "fermer/valider" action),
  // so a retry after a Serializable conflict either safely re-runs the
  // validation or cleanly hits the "deja validee" 409 - never a double
  // stock adjustment. Reuses withLoadingSerializableRetry (see
  // createOrReuseOpenLoading above).
  const loading = await withLoadingSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
      const current = await tx.truckLoading.findFirst({
        where: {
          tourId,
          organizationId: user.organizationId,
        },
        include: {
          tour: { select: { id: true, status: true, depotId: true, truckId: true } },
          lines: {
            select: {
              productId: true,
              quantity: true,
              reloadedQuantity: true,
            },
          },
        },
      });
      if (!current) throw new OperationsServiceError("Chargement introuvable.", 404);
      if (current.status === "VALIDATED") {
        throw new OperationsServiceError("Cette fiche est deja validee.", 409);
      }
      if (current.status !== "DRAFT") {
        throw new OperationsServiceError("Chargement annule, validation impossible.", 409);
      }
      if (!current.tour) {
        throw new OperationsServiceError("Tournee introuvable.", 404);
      }
      if (!["DRAFT", "PREPARED"].includes(current.tour.status)) {
        throw new OperationsServiceError("Statut de tournee incompatible.", 409);
      }
      if (current.lines.length === 0) {
        throw new OperationsServiceError("Ajoutez au moins un produit.", 422);
      }

      const { depotLocationId, truckLocationId } = await resolveLoadingLocationIds(
        tx,
        user.organizationId,
        current.depotId,
        current.truckId,
      );

      // Charge initiale / rechargee are applied to StockLevel as soon as the
      // draft is saved (see applyLoadingStockDelta callers above) — never a
      // second time here. This only runs as a safety net for a loading that
      // was somehow validated without ever going through a draft save.
      if (!current.stockAppliedAt) {
        await applyLoadingStockDelta(tx, {
          loadingId: current.id,
          loadingNumber: current.loadingNumber,
          depotLocationId,
          truckLocationId,
          previousLines: [],
          nextLines: current.lines.map((line) => ({
            productId: line.productId,
            initialQuantity: Math.max(0, line.quantity - line.reloadedQuantity),
            reloadedQuantity: line.reloadedQuantity,
            quantity: line.quantity,
          })),
          stockAlreadyApplied: false,
          organizationId: user.organizationId,
          userId: user.id,
        });

        await tx.truckLoading.update({
          where: { id: current.id },
          data: { stockAppliedAt: new Date() },
        });
      }

      // Every product currently meaningful for this truck (loaded/reloaded on
      // this loading, or still holding stock) must have an explicit real
      // count before the fiche can be validated. An omitted line is never
      // treated as 0.
      const stockedProductIds = await tx.stockLevel.findMany({
        where: {
          organizationId: user.organizationId,
          locationId: truckLocationId,
          quantity: { gt: 0 },
        },
        select: { productId: true },
      });
      const requiredProductIds = new Set([
        ...current.lines.map((line) => line.productId),
        ...stockedProductIds.map((level) => level.productId),
      ]);
      const missingProductIds = [...requiredProductIds].filter(
        (productId) => !providedByProductId.has(productId),
      );
      if (missingProductIds.length > 0) {
        throw new OperationsServiceError(
          "Veuillez saisir la quantite restante reelle pour tous les produits.",
          422,
          Object.fromEntries(
            missingProductIds.map((productId) => [
              productId,
              "Quantite restante reelle manquante.",
            ]),
          ),
        );
      }

      await applyActualRemainingQuantities(tx, {
        loadingId: current.id,
        loadingNumber: current.loadingNumber,
        tourId: current.tour.id,
        truckLocationId,
        organizationId: user.organizationId,
        lines: parsed.data.lines,
        userId: user.id,
      });

      await tx.tour.update({
        where: { id: current.tour.id },
        data: { status: "LOADED" },
      });
      await tx.truck.update({
        where: { id: current.truckId },
        data: { status: "LOADING" },
      });

      return tx.truckLoading.update({
        where: { id: current.id },
        data: {
          status: "VALIDATED",
          validatedAt: new Date(),
          validatedByUserId: user.id,
        },
        include: loadingInclude,
      });
      },
      // 15s: several sequential round-trips per transaction can exceed
      // Prisma's 5s default interactive-transaction timeout (P2028) against
      // Neon's serverless connection latency, even with no real conflict.
      { isolationLevel: "Serializable", timeout: 15000 },
    ),
  );

  return mapTruckLoadingToDto(loading);
}

/**
 * The truth of "Valider le transfert": the theoretical quantity is whatever
 * StockLevel currently holds for the truck (it already reflects charge +
 * recharge + real-time sales — see the module doc above applyLoadingStockDelta
 * and driver-sales.ts). The physically-counted "restante reelle" becomes the
 * new official StockLevel; the gap is recorded as an immutable
 * INVENTORY_ADJUSTMENT movement so the correction is auditable, and the count
 * itself is kept in TourStockCount (the same model already used by the
 * /tournees stock-count screen) so theoreticalQuantity/actualQuantity stay
 * queryable as history via getTourStockSheet.
 */
async function applyActualRemainingQuantities(
  tx: Pick<typeof prisma, "stockLevel" | "stockMovement" | "tourStockCount" | "$queryRaw">,
  input: {
    loadingId: string;
    loadingNumber: string;
    tourId: string;
    truckLocationId: string;
    organizationId: string;
    lines: { productId: string; actualRemainingQuantity: number }[];
    userId: string;
  },
) {
  const now = new Date();

  for (const line of input.lines) {
    const level = await tx.stockLevel.findUnique({
      where: {
        productId_locationId: {
          productId: line.productId,
          locationId: input.truckLocationId,
        },
      },
      select: { id: true, quantity: true },
    });

    const theoreticalQuantity = level?.quantity ?? 0;
    const actualQuantity = line.actualRemainingQuantity;
    const difference = actualQuantity - theoreticalQuantity;

    if (difference !== 0) {
      await tx.stockLevel.upsert({
        where: {
          productId_locationId: {
            productId: line.productId,
            locationId: input.truckLocationId,
          },
        },
        update: { quantity: actualQuantity },
        create: {
          organizationId: input.organizationId,
          productId: line.productId,
          locationId: input.truckLocationId,
          quantity: actualQuantity,
          reservedQuantity: 0,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: input.organizationId,
          movementNumber: await nextMovementNumber(tx, input.organizationId),
          type: "INVENTORY_ADJUSTMENT",
          productId: line.productId,
          quantity: Math.abs(difference),
          sourceLocationId: difference < 0 ? input.truckLocationId : null,
          destinationLocationId: difference > 0 ? input.truckLocationId : null,
          referenceType: "TRUCK_LOADING",
          referenceId: input.loadingId,
          reason: "Cloture chargement - ajustement stock reel",
          note: JSON.stringify({
            loadingNumber: input.loadingNumber,
            theoreticalQuantity,
            actualQuantity,
            difference,
          }),
          createdByUserId: input.userId,
          status: "VALIDATED",
        },
      });
    }

    await tx.tourStockCount.upsert({
      where: {
        tourId_productId: {
          tourId: input.tourId,
          productId: line.productId,
        },
      },
      update: {
        actualQuantity,
        countedAt: now,
        countedByUserId: input.userId,
      },
      create: {
        tourId: input.tourId,
        productId: line.productId,
        actualQuantity,
        countedAt: now,
        countedByUserId: input.userId,
      },
    });
  }
}

async function getLoadingRecordByTourId(tourId: string, organizationId: string) {
  return prisma.truckLoading.findFirst({
    where: {
      tourId,
      organizationId,
    },
    include: loadingInclude,
  });
}

function validateLoadingLines(
  input: TruckLoadingMutationInput,
  options: { allowZeroTotalLines?: boolean } = {},
): NormalizedLoadingLineInput[] {
  const parsed = truckLoadingMutationSchema.safeParse(input);
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

  const seen = new Set<string>();
  for (const line of parsed.data.lines) {
    if (seen.has(line.productId)) {
      throw new OperationsServiceError("Un produit ne peut apparaitre qu'une fois.", 422);
    }
    // The standalone /chargements save allows a 0/0 line (a product prefilled
    // from the driver's last fiche, or one the user hasn't loaded yet) - it
    // moves no stock (applyLoadingStockDelta skips a 0 delta). The tour-scoped
    // callers keep the original "strictly positive" rule.
    if (!options.allowZeroTotalLines && line.initialQuantity + line.reloadedQuantity <= 0) {
      throw new OperationsServiceError(
        "Ajoutez une quantite strictement positive pour chaque produit.",
        422,
        {
          [line.productId]: "La quantite totale doit etre strictement positive.",
        },
      );
    }
    seen.add(line.productId);
  }

  return parsed.data.lines.map((line) => ({
    productId: line.productId,
    initialQuantity: line.initialQuantity,
    reloadedQuantity: line.reloadedQuantity,
    quantity: line.initialQuantity + line.reloadedQuantity,
    actualRemainingQuantity: line.actualRemainingQuantity ?? null,
  }));
}

async function assertProductsExist(
  tx: Pick<typeof prisma, "product">,
  productIds: string[],
  organizationId: string,
) {
  const count = await tx.product.count({
    where: {
      id: { in: productIds },
      organizationId,
      status: "ACTIVE",
    },
  });
  if (count !== productIds.length) {
    throw new OperationsServiceError("Un produit du chargement est introuvable.", 422);
  }
}

async function nextLoadingNumber(
  tx: Pick<typeof prisma, "truckLoading" | "$queryRaw">,
  organizationId: string,
) {
  const number = await reserveDocumentSequence(
    tx,
    organizationId,
    DocumentType.LoadingNumber,
  );
  return `CHG-${String(number).padStart(6, "0")}`;
}

async function resolveLoadingLocationIds(
  tx: Pick<typeof prisma, "stockLocation">,
  organizationId: string,
  depotId: string,
  truckId: string,
) {
  const [depotLocation, truckLocation] = await Promise.all([
    tx.stockLocation.findFirst({
      where: {
        organizationId,
        depotId,
      },
      select: { id: true, type: true },
    }),
    tx.stockLocation.findFirst({
      where: {
        organizationId,
        truckId,
      },
      select: { id: true, type: true },
    }),
  ]);

  if (!depotLocation || depotLocation.type !== "DEPOT") {
    throw new OperationsServiceError("Stock depot source introuvable.", 404);
  }
  if (!truckLocation || truckLocation.type !== "TRUCK") {
    throw new OperationsServiceError("Stock camion destination introuvable.", 404);
  }

  return {
    depotLocationId: depotLocation.id,
    truckLocationId: truckLocation.id,
  };
}

async function applyLoadingStockDelta(
  tx: Pick<typeof prisma, "stockLevel" | "stockMovement" | "$queryRaw">,
  input: {
    loadingId: string;
    loadingNumber: string;
    depotLocationId: string;
    truckLocationId: string;
    previousLines: PersistedLoadingLine[];
    nextLines: NormalizedLoadingLineInput[];
    stockAlreadyApplied: boolean;
    organizationId: string;
    userId: string;
  },
) {
  const previousLineByProductId = new Map(
    input.previousLines.map((line) => [line.productId, line]),
  );
  const nextLineByProductId = new Map(
    input.nextLines.map((line) => [line.productId, line]),
  );
  const productIds = [...new Set([...previousLineByProductId.keys(), ...nextLineByProductId.keys()])];

  for (const productId of productIds) {
    const previousLine = previousLineByProductId.get(productId);
    const nextLine = nextLineByProductId.get(productId);
    const previousAppliedQuantity = input.stockAlreadyApplied
      ? (previousLine?.quantity ?? 0)
      : 0;
    const nextQuantity = nextLine?.quantity ?? 0;
    const deltaQuantity = nextQuantity - previousAppliedQuantity;

    if (deltaQuantity === 0) {
      continue;
    }

    const [depotLevel, truckLevel] = await Promise.all([
      tx.stockLevel.findUnique({
        where: {
          productId_locationId: {
            productId,
            locationId: input.depotLocationId,
          },
        },
      }),
      tx.stockLevel.findUnique({
        where: {
          productId_locationId: {
            productId,
            locationId: input.truckLocationId,
          },
        },
      }),
    ]);

    if (deltaQuantity > 0) {
      const depotAvailable =
        (depotLevel?.quantity ?? 0) - (depotLevel?.reservedQuantity ?? 0);
      if (depotAvailable < deltaQuantity) {
        throw new OperationsServiceError("Stock depot insuffisant pour ce produit.", 422, {
          [productId]: "Stock depot insuffisant pour ce produit.",
        });
      }
      if (!depotLevel) {
        throw new OperationsServiceError("Stock depot source introuvable.", 404);
      }

      await tx.stockLevel.update({
        where: { id: depotLevel.id },
        data: { quantity: { decrement: deltaQuantity } },
      });
      await tx.stockLevel.upsert({
        where: {
          productId_locationId: {
            productId,
            locationId: input.truckLocationId,
          },
        },
        update: { quantity: { increment: deltaQuantity } },
        create: {
          organizationId: input.organizationId,
          productId,
          locationId: input.truckLocationId,
          quantity: deltaQuantity,
          reservedQuantity: 0,
        },
      });
    } else {
      const reverseQuantity = Math.abs(deltaQuantity);
      const truckAvailable =
        (truckLevel?.quantity ?? 0) - (truckLevel?.reservedQuantity ?? 0);

      if (!truckLevel || truckAvailable < reverseQuantity) {
        throw new OperationsServiceError(
          "Le camion ne possede pas assez de stock pour reduire ce chargement.",
          422,
          {
            [productId]:
              "Le camion ne possede pas assez de stock pour reduire ce chargement.",
          },
        );
      }

      await tx.stockLevel.update({
        where: { id: truckLevel.id },
        data: { quantity: { decrement: reverseQuantity } },
      });
      await tx.stockLevel.upsert({
        where: {
          productId_locationId: {
            productId,
            locationId: input.depotLocationId,
          },
        },
        update: { quantity: { increment: reverseQuantity } },
        create: {
          organizationId: input.organizationId,
          productId,
          locationId: input.depotLocationId,
          quantity: reverseQuantity,
          reservedQuantity: 0,
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        organizationId: input.organizationId,
        movementNumber: await nextMovementNumber(tx, input.organizationId),
        type: "TRUCK_LOADING",
        productId,
        quantity: Math.abs(deltaQuantity),
        sourceLocationId:
          deltaQuantity > 0 ? input.depotLocationId : input.truckLocationId,
        destinationLocationId:
          deltaQuantity > 0 ? input.truckLocationId : input.depotLocationId,
        referenceType: "TRUCK_LOADING",
        referenceId: input.loadingId,
        reason:
          deltaQuantity > 0
            ? "Chargement brouillon applique"
            : "Correction de chargement brouillon",
        note: buildLoadingMovementNote({
          loadingNumber: input.loadingNumber,
          previousLine,
          nextLine,
          deltaQuantity,
        }),
        createdByUserId: input.userId,
        status: "VALIDATED",
      },
    });
  }
}

function buildLoadingMovementNote({
  loadingNumber,
  previousLine,
  nextLine,
  deltaQuantity,
}: {
  loadingNumber: string;
  previousLine?: PersistedLoadingLine;
  nextLine?: NormalizedLoadingLineInput;
  deltaQuantity: number;
}) {
  const previousInitialQuantity = previousLine
    ? Math.max(0, previousLine.quantity - previousLine.reloadedQuantity)
    : 0;

  return JSON.stringify({
    loadingNumber,
    previousInitialQuantity,
    previousReloadedQuantity: previousLine?.reloadedQuantity ?? 0,
    nextInitialQuantity: nextLine?.initialQuantity ?? 0,
    nextReloadedQuantity: nextLine?.reloadedQuantity ?? 0,
    deltaQuantity,
  });
}

export function mapLoadingError(error: unknown) {
  if (error instanceof OperationsServiceError || error instanceof AuthServiceError) {
    return error;
  }
  const prismaError = error as { code?: string };
  if (prismaError.code === "P2002") {
    return new OperationsServiceError(
      "Une fiche de chargement est deja ouverte pour ce camion.",
      409,
    );
  }
  if (prismaError.code === "P2025") {
    return new OperationsServiceError("Chargement introuvable.", 404);
  }
  return new OperationsServiceError("Une erreur est survenue.", 500);
}
