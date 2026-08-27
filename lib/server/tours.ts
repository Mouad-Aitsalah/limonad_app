import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { TourGetPayload } from "@/lib/generated/prisma/models/Tour";
import { AuthServiceError, requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getLoadingByTourId } from "@/lib/server/truck-loadings";
import type {
  TourDto,
  TourMutationInput,
  TourStockCountMutationInput,
  TourStockSheetDto,
  TourSummaryDto,
} from "@/types/operations-dto";

const openTourStatuses = ["DRAFT", "PREPARED", "LOADED", "IN_PROGRESS"] as const;

const tourInclude = {
  depot: { select: { id: true, code: true, name: true } },
  truck: { select: { id: true, code: true, registration: true, status: true } },
  driver: {
    select: {
      id: true,
      employeeCode: true,
      user: { select: { fullName: true } },
    },
  },
  createdBy: { select: { fullName: true } },
  loading: {
    select: {
      id: true,
      loadingNumber: true,
      status: true,
      stockAppliedAt: true,
      validatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

type TourWithRelations = TourGetPayload<{ include: typeof tourInclude }>;

export const tourMutationSchema = z.object({
  date: z.coerce.date({ error: "La date est obligatoire." }),
  truckId: z.string().trim().min(1, "Le camion est obligatoire."),
});

const tourStockCountMutationSchema = z.object({
  lines: z.array(
    z.object({
      productId: z.string().trim().min(1, "Le produit est obligatoire."),
      actualQuantity: z.coerce
        .number()
        .int("La quantite reelle doit etre un nombre entier.")
        .min(0, "La quantite reelle ne peut pas etre negative."),
      note: z.string().trim().nullable().optional(),
    }),
  ),
});

export async function mapTourToDto(tour: TourWithRelations): Promise<TourDto> {
  const [loading, stockSheet] = await Promise.all([
    getLoadingByTourId(tour.id),
    getTourStockSheet(tour),
  ]);

  return {
    id: tour.id,
    code: tour.code,
    date: tour.date.toISOString(),
    status: tour.status,
    startedAt: tour.startedAt?.toISOString() ?? null,
    returnedAt: tour.returnedAt?.toISOString() ?? null,
    closedAt: tour.closedAt?.toISOString() ?? null,
    depot: tour.depot,
    truck: tour.truck,
    driver: {
      id: tour.driver.id,
      employeeCode: tour.driver.employeeCode,
      name: tour.driver.user.fullName,
    },
    loading,
    stockSheet,
    createdByUserName: tour.createdBy.fullName,
    createdAt: tour.createdAt.toISOString(),
    updatedAt: tour.updatedAt.toISOString(),
  };
}

export function mapTourToSummaryDto(tour: TourWithRelations): TourSummaryDto {
  return {
    id: tour.id,
    code: tour.code,
    date: tour.date.toISOString(),
    status: tour.status,
    depotName: tour.depot.name,
    truckCode: tour.truck.code,
    driverName: tour.driver.user.fullName,
    loadingStatus: tour.loading?.status ?? null,
    startedAt: tour.startedAt?.toISOString() ?? null,
    returnedAt: tour.returnedAt?.toISOString() ?? null,
  };
}

export async function getTours(): Promise<TourDto[]> {
  const tours = await prisma.tour.findMany({
    include: tourInclude,
    orderBy: [{ date: "desc" }, { code: "desc" }],
  });
  return Promise.all(tours.map(mapTourToDto));
}

export async function getTourById(id: string): Promise<TourDto> {
  const tour = await getTourRecordById(id);
  if (!tour) throw new OperationsServiceError("Fiche journaliere introuvable.", 404);
  return mapTourToDto(tour);
}

export async function createTour(input: TourMutationInput): Promise<TourDto> {
  const user = await requireSessionUser(["admin", "depot_manager"]);
  const data = await validateTourInput(input);
  const date = normalizeTourDate(data.date);

  try {
    const tour = await prisma.$transaction(async (tx) => {
      const truck = await tx.truck.findUnique({
        where: { id: data.truckId },
        select: {
          id: true,
          depotId: true,
          status: true,
          assignedDriver: { select: { id: true, active: true } },
          defaultDriver: { select: { id: true, active: true } },
        },
      });

      const resolvedTruck = resolveTruckAssignment(truck);

      const existing = await tx.tour.findFirst({
        where: { truckId: resolvedTruck.id, date },
        include: tourInclude,
      });
      if (existing) return existing;

      await ensureTourAvailability({
        date,
        truckId: resolvedTruck.id,
        driverId: resolvedTruck.driverId,
      });

      return tx.tour.create({
        data: {
          code: await nextTourCode(tx),
          date,
          depotId: resolvedTruck.depotId,
          truckId: resolvedTruck.id,
          driverId: resolvedTruck.driverId,
          status: "PREPARED",
          createdByUserId: user.id,
        },
        include: tourInclude,
      });
    });

    return mapTourToDto(tour);
  } catch (error) {
    throw mapTourError(error);
  }
}

export async function updateDraftTour(
  id: string,
  input: TourMutationInput,
): Promise<TourDto> {
  await requireSessionUser(["admin", "depot_manager"]);
  const data = await validateTourInput(input);
  const date = normalizeTourDate(data.date);

  try {
    const tour = await prisma.$transaction(async (tx) => {
      const existing = await tx.tour.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!existing) {
        throw new OperationsServiceError("Fiche journaliere introuvable.", 404);
      }
      if (existing.status !== "DRAFT" && existing.status !== "PREPARED") {
        throw new OperationsServiceError(
          "Seule une fiche brouillon ou preparee peut etre modifiee.",
          409,
        );
      }

      const truck = await tx.truck.findUnique({
        where: { id: data.truckId },
        select: {
          id: true,
          depotId: true,
          status: true,
          assignedDriver: { select: { id: true, active: true } },
          defaultDriver: { select: { id: true, active: true } },
        },
      });

      const resolvedTruck = resolveTruckAssignment(truck);

      await ensureTourAvailability({
        date,
        truckId: resolvedTruck.id,
        driverId: resolvedTruck.driverId,
        currentTourId: id,
      });

      return tx.tour.update({
        where: { id },
        data: {
          date,
          depotId: resolvedTruck.depotId,
          truckId: resolvedTruck.id,
          driverId: resolvedTruck.driverId,
          status: "PREPARED",
        },
        include: tourInclude,
      });
    });

    return mapTourToDto(tour);
  } catch (error) {
    throw mapTourError(error);
  }
}

export async function updateTourStockCounts(
  tourId: string,
  input: TourStockCountMutationInput,
): Promise<TourDto> {
  const user = await requireSessionUser(["admin", "depot_manager"]);
  const data = validateTourStockCountsInput(input);

  try {
    await prisma.$transaction(async (tx) => {
      const tour = await tx.tour.findUnique({
        where: { id: tourId },
        select: { id: true },
      });
      if (!tour) {
        throw new OperationsServiceError("Fiche journaliere introuvable.", 404);
      }

      const productIds = data.lines.map((line) => line.productId);
      if (productIds.length > 0) {
        const productsCount = await tx.product.count({
          where: { id: { in: productIds } },
        });
        if (productsCount !== productIds.length) {
          throw new OperationsServiceError("Un produit est introuvable.", 422);
        }
      }

      if (productIds.length === 0) {
        await tx.tourStockCount.deleteMany({ where: { tourId } });
        return;
      }

      await tx.tourStockCount.deleteMany({
        where: { tourId, productId: { notIn: productIds } },
      });

      for (const line of data.lines) {
        await tx.tourStockCount.upsert({
          where: {
            tourId_productId: {
              tourId,
              productId: line.productId,
            },
          },
          update: {
            actualQuantity: line.actualQuantity,
            note: line.note ?? null,
            countedAt: new Date(),
            countedByUserId: user.id,
          },
          create: {
            tourId,
            productId: line.productId,
            actualQuantity: line.actualQuantity,
            note: line.note ?? null,
            countedAt: new Date(),
            countedByUserId: user.id,
          },
        });
      }
    });

    return getTourById(tourId);
  } catch (error) {
    throw mapTourError(error);
  }
}

export async function cancelTour(id: string): Promise<TourDto> {
  await requireSessionUser(["admin", "depot_manager"]);
  const tour = await prisma.tour.findUnique({
    where: { id },
    select: { id: true, status: true, loading: { select: { status: true } } },
  });
  if (!tour) throw new OperationsServiceError("Fiche journaliere introuvable.", 404);
  if (tour.status === "IN_PROGRESS" || tour.status === "WAITING_FOR_CLOSURE") {
    throw new OperationsServiceError("Cette fiche ne peut plus etre annulee.", 409);
  }
  if (tour.loading?.status === "VALIDATED") {
    throw new OperationsServiceError("Une fiche chargee ne peut plus etre annulee.", 409);
  }

  const updated = await prisma.tour.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: tourInclude,
  });
  await prisma.truckLoading.updateMany({
    where: { tourId: id, status: "DRAFT" },
    data: { status: "CANCELLED" },
  });
  return mapTourToDto(updated);
}

export async function startTour(tourId: string, userId?: string): Promise<TourDto> {
  const user = userId ? await requireSessionUser(["driver"]) : await requireSessionUser(["driver"]);
  if (!user.driverId || !user.truckId) {
    throw new AuthServiceError("Aucun camion n'est affecte a votre compte.", 403);
  }

  const tour = await prisma.$transaction(async (tx) => {
    const existing = await tx.tour.findUnique({
      where: { id: tourId },
      select: {
        id: true,
        status: true,
        truckId: true,
        driverId: true,
        loading: { select: { status: true } },
      },
    });
    if (!existing) throw new OperationsServiceError("Fiche journaliere introuvable.", 404);
    if (existing.driverId !== user.driverId || existing.truckId !== user.truckId) {
      throw new AuthServiceError("Cette fiche ne vous appartient pas.", 403);
    }
    if (existing.status !== "LOADED" || existing.loading?.status !== "VALIDATED") {
      throw new OperationsServiceError("Le chargement doit etre valide avant depart.", 409);
    }

    const activeTour = await tx.tour.findFirst({
      where: {
        id: { not: tourId },
        truckId: user.truckId,
        status: "IN_PROGRESS",
      },
      select: { id: true },
    });
    if (activeTour) {
      throw new OperationsServiceError("Ce camion possede deja une tournee active.", 409);
    }

    await tx.truck.update({
      where: { id: user.truckId },
      data: { status: "ON_TOUR" },
    });

    return tx.tour.update({
      where: { id: tourId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
      include: tourInclude,
    });
  });

  return mapTourToDto(tour);
}

export async function createAndStartTourForCurrentDriver(): Promise<TourDto> {
  const user = await requireSessionUser(["driver"]);
  if (!user.driverId || !user.truckId) {
    throw new AuthServiceError("Aucun camion n'est affecte a votre compte.", 403);
  }

  try {
    const tour = await withTourSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const driver = await tx.driver.findUnique({
            where: { id: user.driverId },
            select: {
              id: true,
              active: true,
              truckId: true,
              user: { select: { fullName: true } },
              truck: {
                select: {
                  id: true,
                  code: true,
                  registration: true,
                  status: true,
                  depotId: true,
                },
              },
            },
          });

          if (!driver?.active || !driver.truck || driver.truckId !== user.truckId) {
            throw new OperationsServiceError("Profil chauffeur ou camion invalide.", 403);
          }

          const existingDriverTour = await tx.tour.findFirst({
            where: {
              driverId: driver.id,
              status: "IN_PROGRESS",
            },
            include: tourInclude,
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
          });
          if (existingDriverTour) {
            return existingDriverTour;
          }

          const existingTruckTour = await tx.tour.findFirst({
            where: {
              truckId: driver.truck.id,
              status: "IN_PROGRESS",
            },
            include: tourInclude,
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
          });
          if (existingTruckTour) {
            throw new OperationsServiceError("Ce camion possede deja une tournee active.", 409);
          }

          const today = getTodayTourDate();
          const existingDailySheet = await tx.tour.findUnique({
            where: {
              truckId_date: {
                truckId: driver.truck.id,
                date: today,
              },
            },
            include: tourInclude,
          });

          if (existingDailySheet) {
            return startExistingDailyTour(tx, {
              tour: existingDailySheet,
              driverId: driver.id,
              truckId: driver.truck.id,
            });
          }

          await tx.truck.update({
            where: { id: driver.truck.id },
            data: { status: "ON_TOUR" },
          });

          return tx.tour.create({
            data: {
              code: await nextTourCode(tx),
              date: today,
              depotId: driver.truck.depotId,
              truckId: driver.truck.id,
              driverId: driver.id,
              status: "IN_PROGRESS",
              startedAt: new Date(),
              createdByUserId: user.id,
            },
            include: tourInclude,
          });
        },
        { isolationLevel: "Serializable" },
      ),
    );

    return mapTourToDto(tour);
  } catch (error) {
    throw mapTourError(error);
  }
}

export async function markTourReturned(tourId: string): Promise<TourDto> {
  const user = await requireSessionUser(["driver"]);
  if (!user.driverId || !user.truckId) {
    throw new AuthServiceError("Aucun camion n'est affecte a votre compte.", 403);
  }

  const tour = await prisma.$transaction(async (tx) => {
    const existing = await tx.tour.findUnique({
      where: { id: tourId },
      select: {
        id: true,
        status: true,
        truckId: true,
        driverId: true,
        loading: { select: { status: true } },
      },
    });
    if (!existing) throw new OperationsServiceError("Fiche journaliere introuvable.", 404);
    if (existing.driverId !== user.driverId || existing.truckId !== user.truckId) {
      throw new AuthServiceError("Cette fiche ne vous appartient pas.", 403);
    }
    if (existing.status === "WAITING_FOR_CLOSURE" || existing.status === "CLOSED") {
      return tx.tour.findUniqueOrThrow({
        where: { id: tourId },
        include: tourInclude,
      });
    }
    if (existing.status !== "IN_PROGRESS") {
      throw new OperationsServiceError("Seule une tournee en cours peut etre retournee.", 409);
    }

    await tx.truck.update({
      where: { id: user.truckId },
      data: { status: "AVAILABLE" },
    });

    return tx.tour.update({
      where: { id: tourId },
      data: { status: "WAITING_FOR_CLOSURE", returnedAt: new Date() },
      include: tourInclude,
    });
  });

  return mapTourToDto(tour);
}

export async function markCurrentDriverTourReturned(): Promise<TourDto> {
  const user = await requireSessionUser(["driver"]);
  if (!user.driverId || !user.truckId) {
    throw new AuthServiceError("Aucun camion n'est affecte a votre compte.", 403);
  }

  const activeTour = await prisma.tour.findFirst({
    where: {
      driverId: user.driverId,
      truckId: user.truckId,
      status: "IN_PROGRESS",
    },
    select: { id: true },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
  });

  if (activeTour) {
    return markTourReturned(activeTour.id);
  }

  const latestClosedTour = await prisma.tour.findFirst({
    where: {
      driverId: user.driverId,
      truckId: user.truckId,
      status: {
        in: ["WAITING_FOR_CLOSURE", "CLOSED"],
      },
    },
    select: { id: true },
    orderBy: [{ returnedAt: "desc" }, { startedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!latestClosedTour) {
    throw new OperationsServiceError("Aucune tournee active pour ce chauffeur.", 404);
  }

  return getTourById(latestClosedTour.id);
}

export async function getActiveTourForDriver(driverId: string): Promise<TourDto | null> {
  const tour = await prisma.tour.findFirst({
    where: {
      driverId,
      status: "IN_PROGRESS",
    },
    include: tourInclude,
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
  });
  return tour ? mapTourToDto(tour) : null;
}

export async function requireActiveTourForDriver(driverId: string): Promise<TourDto> {
  const tour = await getActiveTourForDriver(driverId);
  if (!tour) {
    throw new OperationsServiceError("Aucune tournee active pour ce chauffeur.", 404);
  }
  return tour;
}

export async function getToursForDriver(driverId: string): Promise<TourDto[]> {
  const tours = await prisma.tour.findMany({
    where: { driverId },
    include: tourInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return Promise.all(tours.map(mapTourToDto));
}

export async function getToursForTruck(truckId: string): Promise<TourDto[]> {
  const tours = await prisma.tour.findMany({
    where: { truckId },
    include: tourInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return Promise.all(tours.map(mapTourToDto));
}

async function getTourRecordById(id: string) {
  return prisma.tour.findUnique({ where: { id }, include: tourInclude });
}

async function validateTourInput(input: TourMutationInput) {
  const parsed = tourMutationSchema.safeParse(input);
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
  return parsed.data;
}

function validateTourStockCountsInput(input: TourStockCountMutationInput) {
  const parsed = tourStockCountMutationSchema.safeParse(input);
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
    seen.add(line.productId);
  }

  return parsed.data;
}

function normalizeTourDate(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getTodayTourDate() {
  const dateParam = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return new Date(`${dateParam}T00:00:00.000Z`);
}

async function startExistingDailyTour(
  tx: Pick<typeof prisma, "tour" | "truck">,
  {
    tour,
    driverId,
    truckId,
  }: {
    tour: TourWithRelations;
    driverId: string;
    truckId: string;
  },
) {
  if (tour.driver.id !== driverId || tour.truck.id !== truckId) {
    throw new AuthServiceError("Cette fiche ne vous appartient pas.", 403);
  }

  if (tour.status === "IN_PROGRESS") {
    return tour;
  }

  if (tour.status === "WAITING_FOR_CLOSURE" || tour.status === "CLOSED") {
    throw new OperationsServiceError(
      "La tournee du jour est deja terminee pour ce camion.",
      409,
    );
  }

  if (tour.status === "CANCELLED" || tour.status === "INTERRUPTED") {
    throw new OperationsServiceError(
      "La fiche journaliere du jour ne peut pas etre relancee.",
      409,
    );
  }

  if (!tour.loading) {
    throw new OperationsServiceError(
      "Aucune fiche de chargement n'existe pour ce camion aujourd'hui.",
      409,
    );
  }

  const canStartFromDraft =
    tour.loading.status === "DRAFT" && Boolean(tour.loading.stockAppliedAt);
  const canStartFromValidated = tour.loading.status === "VALIDATED";

  if (!canStartFromDraft && !canStartFromValidated) {
    throw new OperationsServiceError(
      "Le chargement doit etre valide avant de commencer la tournee.",
      409,
    );
  }

  await tx.truck.update({
    where: { id: truckId },
    data: { status: "ON_TOUR" },
  });

  return tx.tour.update({
    where: { id: tour.id },
    data: {
      status: "IN_PROGRESS",
      startedAt: tour.startedAt ?? new Date(),
    },
    include: tourInclude,
  });
}

function resolveTruckAssignment(
  truck: {
    id: string;
    depotId: string;
    status: string;
    assignedDriver: { id: string; active: boolean } | null;
    defaultDriver: { id: string; active: boolean } | null;
  } | null,
) {
  const fieldErrors: Record<string, string> = {};

  if (!truck) {
    fieldErrors.truckId = "Camion introuvable.";
  } else if (truck.status === "INACTIVE") {
    fieldErrors.truckId = "Le camion est inactif.";
  }

  const activeAssignedDriver = truck?.assignedDriver?.active ? truck.assignedDriver : null;
  const activeDefaultDriver = truck?.defaultDriver?.active ? truck.defaultDriver : null;
  const resolvedDriver = activeAssignedDriver ?? activeDefaultDriver ?? null;

  if (!resolvedDriver) {
    fieldErrors.truckId = "Aucun chauffeur actif n'est affecte a ce camion.";
  }

  if (Object.keys(fieldErrors).length > 0 || !truck || !resolvedDriver) {
    throw new OperationsServiceError("Certains champs sont invalides.", 422, fieldErrors);
  }

  return {
    id: truck.id,
    depotId: truck.depotId,
    driverId: resolvedDriver.id,
  };
}

async function ensureTourAvailability({
  date,
  truckId,
  driverId,
  currentTourId,
}: {
  date: Date;
  truckId: string;
  driverId: string;
  currentTourId?: string;
}) {
  const [sameTruckSameDate, openTruckTour, openDriverTour] = await Promise.all([
    prisma.tour.findFirst({
      where: {
        truckId,
        date,
        ...(currentTourId ? { id: { not: currentTourId } } : {}),
      },
      select: { id: true },
    }),
    prisma.tour.findFirst({
      where: {
        truckId,
        status: { in: [...openTourStatuses] },
        ...(currentTourId ? { id: { not: currentTourId } } : {}),
      },
      select: { id: true },
    }),
    prisma.tour.findFirst({
      where: {
        driverId,
        status: { in: [...openTourStatuses] },
        ...(currentTourId ? { id: { not: currentTourId } } : {}),
      },
      select: { id: true },
    }),
  ]);

  if (sameTruckSameDate) {
    throw new OperationsServiceError(
      "Ce camion possede deja une fiche journaliere a cette date.",
      409,
      {
        truckId: "Ce camion possede deja une fiche journaliere a cette date.",
      },
    );
  }
  if (openTruckTour) {
    throw new OperationsServiceError("Ce camion possede deja une tournee ouverte.", 409);
  }
  if (openDriverTour) {
    throw new OperationsServiceError("Ce chauffeur possede deja une tournee ouverte.", 409);
  }
}

async function getTourStockSheet(tour: TourWithRelations): Promise<TourStockSheetDto> {
  const truckLocation = await prisma.stockLocation.findUnique({
    where: { truckId: tour.truck.id },
    select: { id: true },
  });

  if (!truckLocation) {
    return {
      truckCurrentQuantity: 0,
      productCount: 0,
      lines: [],
    };
  }

  const dayStart = normalizeTourDate(tour.date);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const [loadingLines, openingMovements, reloadingMovements, saleLines, stockCounts, currentLevels] =
    await Promise.all([
      tour.loading?.id
        ? prisma.truckLoadingLine.findMany({
            where: { loadingId: tour.loading.id },
            include: {
              product: {
                select: { id: true, reference: true, name: true, unit: true },
              },
            },
          })
        : Promise.resolve([]),
      prisma.stockMovement.findMany({
        where: {
          status: "VALIDATED",
          createdAt: { lt: dayStart },
          OR: [
            { sourceLocationId: truckLocation.id },
            { destinationLocationId: truckLocation.id },
          ],
        },
        select: {
          productId: true,
          quantity: true,
          sourceLocationId: true,
          destinationLocationId: true,
        },
      }),
      prisma.stockMovement.findMany({
        where: {
          status: "VALIDATED",
          type: "TRUCK_LOADING",
          createdAt: { gte: dayStart, lt: dayEnd },
          destinationLocationId: truckLocation.id,
        },
        select: {
          productId: true,
          quantity: true,
          referenceId: true,
        },
      }),
      prisma.saleLine.findMany({
        where: {
          sale: {
            tourId: tour.id,
            status: { not: "CANCELLED" },
          },
        },
        include: {
          product: {
            select: { id: true, reference: true, name: true, unit: true },
          },
        },
      }),
      prisma.tourStockCount.findMany({
        where: { tourId: tour.id },
        select: {
          productId: true,
          actualQuantity: true,
          countedAt: true,
          note: true,
        },
      }),
      prisma.stockLevel.findMany({
        where: { locationId: truckLocation.id, quantity: { gt: 0 } },
        select: { productId: true, quantity: true },
      }),
    ]);

  const initialQuantities = new Map<string, number>();
  for (const movement of openingMovements) {
    const current = initialQuantities.get(movement.productId) ?? 0;
    const delta =
      (movement.destinationLocationId === truckLocation.id ? movement.quantity : 0) -
      (movement.sourceLocationId === truckLocation.id ? movement.quantity : 0);
    initialQuantities.set(movement.productId, current + delta);
  }

  const loadedQuantities = new Map<string, number>();
  for (const line of loadingLines) {
    const initialQuantity = Math.max(0, line.quantity - line.reloadedQuantity);
    loadedQuantities.set(
      line.productId,
      (loadedQuantities.get(line.productId) ?? 0) + initialQuantity,
    );
  }

  const reloadedQuantities = new Map<string, number>();
  for (const line of loadingLines) {
    if (line.reloadedQuantity <= 0) continue;
    reloadedQuantities.set(
      line.productId,
      (reloadedQuantities.get(line.productId) ?? 0) + line.reloadedQuantity,
    );
  }
  for (const movement of reloadingMovements) {
    if (movement.referenceId && movement.referenceId === tour.loading?.id) continue;
    reloadedQuantities.set(
      movement.productId,
      (reloadedQuantities.get(movement.productId) ?? 0) + movement.quantity,
    );
  }

  const soldQuantities = new Map<string, number>();
  for (const line of saleLines) {
    soldQuantities.set(line.productId, (soldQuantities.get(line.productId) ?? 0) + line.quantity);
  }

  const countsByProductId = new Map(
    stockCounts.map((count) => [
      count.productId,
      {
        actualQuantity: count.actualQuantity,
        countedAt: count.countedAt.toISOString(),
        note: count.note,
      },
    ]),
  );

  const productIds = new Set<string>();
  for (const productId of initialQuantities.keys()) productIds.add(productId);
  for (const productId of loadedQuantities.keys()) productIds.add(productId);
  for (const productId of reloadedQuantities.keys()) productIds.add(productId);
  for (const productId of soldQuantities.keys()) productIds.add(productId);
  for (const productId of countsByProductId.keys()) productIds.add(productId);
  for (const level of currentLevels) productIds.add(level.productId);

  if (productIds.size === 0) {
    return {
      truckCurrentQuantity: 0,
      productCount: 0,
      lines: [],
    };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: [...productIds] } },
    select: {
      id: true,
      reference: true,
      name: true,
      unit: true,
    },
    orderBy: { name: "asc" },
  });

  const productMap = new Map(products.map((product) => [product.id, product]));
  const lines = [...productIds]
    .map((productId) => {
      const product = productMap.get(productId);
      if (!product) return null;

      const initialQuantity = initialQuantities.get(productId) ?? 0;
      const loadedQuantity = loadedQuantities.get(productId) ?? 0;
      const reloadedQuantity = reloadedQuantities.get(productId) ?? 0;
      const soldQuantity = soldQuantities.get(productId) ?? 0;
      const theoreticalQuantity =
        initialQuantity + loadedQuantity + reloadedQuantity - soldQuantity;
      const stockCount = countsByProductId.get(productId);
      const actualQuantity = stockCount?.actualQuantity ?? null;

      return {
        productId,
        productReference: product.reference,
        productName: product.name,
        productUnit: product.unit,
        initialQuantity,
        loadedQuantity,
        reloadedQuantity,
        soldQuantity,
        theoreticalQuantity,
        actualQuantity,
        differenceQuantity:
          actualQuantity === null ? null : actualQuantity - theoreticalQuantity,
        countedAt: stockCount?.countedAt ?? null,
        note: stockCount?.note ?? null,
      };
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  return {
    truckCurrentQuantity: currentLevels.reduce((sum, level) => sum + level.quantity, 0),
    productCount: currentLevels.length,
    lines,
  };
}

async function nextTourCode(tx: Pick<typeof prisma, "tour">) {
  const year = new Date().getUTCFullYear();
  const prefix = `TOUR-${year}-`;
  const tours = await tx.tour.findMany({
    where: {
      code: {
        startsWith: prefix,
      },
    },
    select: { code: true },
  });

  const codePattern = new RegExp(`^${prefix}(\\d+)$`);
  const highestSequence = tours.reduce((highest, tour) => {
    const sequence = tour.code.match(codePattern)?.[1];
    if (!sequence) return highest;
    return Math.max(highest, Number.parseInt(sequence, 10));
  }, 0);
  const nextSequence = highestSequence + 1;

  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
}

function mapTourError(error: unknown) {
  if (error instanceof OperationsServiceError || error instanceof AuthServiceError) {
    return error;
  }
  const prismaError = error as { code?: string; meta?: { target?: string[] | string } };
  if (prismaError.code === "P2002") {
    const target = Array.isArray(prismaError.meta?.target)
      ? prismaError.meta.target
      : [prismaError.meta?.target].filter(Boolean);
    const targetText = target.join(",").toLowerCase();

    if (targetText.includes("code")) {
      return new OperationsServiceError(
        "Une fiche journaliere existe deja avec ce code. Veuillez reessayer.",
        409,
      );
    }

    return new OperationsServiceError(
      "Une fiche journaliere existe deja pour ce camion a cette date.",
      409,
    );
  }
  if (prismaError.code === "P2025") {
    return new OperationsServiceError("Fiche journaliere introuvable.", 404);
  }
  return new OperationsServiceError("Une erreur est survenue.", 500);
}

async function withTourSerializableRetry<T>(
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

  throw new OperationsServiceError("Impossible de demarrer la tournee.", 500);
}
