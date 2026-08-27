import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { TruckLoadingGetPayload } from "@/lib/generated/prisma/models/TruckLoading";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { nextMovementNumber } from "@/lib/server/sales-shared";
import type {
  TruckLoadingCreateInput,
  TruckLoadingDto,
  TruckLoadingEditInput,
  TruckLoadingMutationInput,
  TruckLoadingValidationInput,
} from "@/types/operations-dto";

const loadingInclude = {
  depot: { select: { id: true, name: true } },
  truck: { select: { id: true, code: true } },
  driver: { select: { id: true, user: { select: { fullName: true } } } },
  createdBy: { select: { fullName: true } },
  validatedBy: { select: { fullName: true } },
  updatedBy: { select: { fullName: true } },
  lines: {
    include: {
      product: { select: { id: true, reference: true, name: true } },
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

export async function getLoadingHistory(): Promise<TruckLoadingDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager"]);
  const loadings = await prisma.truckLoading.findMany({
    where: { organizationId: currentUser.organizationId },
    include: loadingInclude,
    orderBy: [{ loadingYear: "desc" }, { loadingSequence: "desc" }, { createdAt: "desc" }],
  });
  return Promise.all(loadings.map(mapTruckLoadingToDto));
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
          },
          include: loadingInclude,
        });
        return { loading: created, reused: false };
      },
      { isolationLevel: "Serializable" },
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
  const lines = validateLoadingLines(input);

  const loading = await prisma.$transaction(
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
        })),
      });

      return tx.truckLoading.update({
        where: { id: current.id },
        data: { stockAppliedAt: current.stockAppliedAt ?? new Date() },
        include: loadingInclude,
      });
    },
    { isolationLevel: "Serializable" },
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

  const loading = await prisma.$transaction(
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
    { isolationLevel: "Serializable" },
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

  const loading = await prisma.$transaction(
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
    { isolationLevel: "Serializable" },
  );

  return mapTruckLoadingToDto(loading);
}

async function applyActualRemainingQuantitiesOnLine(
  tx: Pick<typeof prisma, "stockLevel" | "stockMovement" | "truckLoadingLine">,
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
  tx: Pick<typeof prisma, "truckLoading">,
  organizationId: string,
) {
  const year = new Date().getFullYear();
  const count = await tx.truckLoading.count({
    where: {
      organizationId,
      loadingYear: year,
    },
  });
  return { year, sequence: count + 1 };
}

async function withLoadingSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const prismaError = error as { code?: string };
      attempt += 1;
      if (!["P2002", "P2034"].includes(prismaError.code ?? "") || attempt >= maxAttempts) {
        throw error;
      }
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

  const loading = await prisma.$transaction(
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
    { isolationLevel: "Serializable" },
  );

  return mapTruckLoadingToDto(loading);
}

export async function updateDraftLoading(
  tourId: string,
  input: TruckLoadingMutationInput,
): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const lines = validateLoadingLines(input);

  const loading = await prisma.$transaction(
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
    { isolationLevel: "Serializable" },
  );

  return mapTruckLoadingToDto(loading);
}

export async function cancelDraftLoading(tourId: string): Promise<TruckLoadingDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  const loading = await prisma.$transaction(
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
    { isolationLevel: "Serializable" },
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

  const loading = await prisma.$transaction(
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
    { isolationLevel: "Serializable" },
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
  tx: Pick<typeof prisma, "stockLevel" | "stockMovement" | "tourStockCount">,
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

function validateLoadingLines(input: TruckLoadingMutationInput): NormalizedLoadingLineInput[] {
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
    if (line.initialQuantity + line.reloadedQuantity <= 0) {
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
  tx: Pick<typeof prisma, "truckLoading">,
  organizationId: string,
) {
  const count = await tx.truckLoading.count({ where: { organizationId } });
  return `CHG-${String(count + 1).padStart(6, "0")}`;
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
  tx: Pick<typeof prisma, "stockLevel" | "stockMovement">,
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
