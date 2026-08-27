import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const openTourStatuses = ["DRAFT", "PREPARED", "LOADED", "IN_PROGRESS"] as const;

type TourAuditRecord = Awaited<ReturnType<typeof getToursForAudit>>[number];

async function main() {
  const [
    tours,
    validatedLoadings,
    truckSales,
    truckStockLevels,
    stockLevels,
  ] = await Promise.all([
    getToursForAudit(),
    getValidatedLoadingsForAudit(),
    getTruckSalesForAudit(),
    prisma.stockLevel.findMany({
      where: { location: { type: "TRUCK" } },
      select: {
        id: true,
        productId: true,
        quantity: true,
        reservedQuantity: true,
        location: { select: { id: true, truckId: true, code: true } },
        product: { select: { reference: true, name: true } },
      },
      orderBy: [{ location: { code: "asc" } }, { product: { name: "asc" } }],
    }),
    prisma.stockLevel.findMany({
      select: { id: true, productId: true, locationId: true, quantity: true },
    }),
  ]);

  const inconsistentTours = tours
    .map((tour) => buildTourInconsistency(tour, truckStockLevels))
    .filter((tour): tour is NonNullable<typeof tour> => Boolean(tour));

  const openByTruck = groupBy(
    tours.filter((tour) => isOpenTourStatus(tour.status)),
    (tour) => tour.truckId,
  );
  const openByDriver = groupBy(
    tours.filter((tour) => isOpenTourStatus(tour.status)),
    (tour) => tour.driverId,
  );

  const duplicateStockLevels = Object.entries(
    groupBy(stockLevels, (level) => `${level.productId}:${level.locationId}`),
  )
    .filter(([, levels]) => levels.length > 1)
    .map(([key, levels]) => ({ key, count: levels.length, ids: levels.map((level) => level.id) }));

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      tours: tours.length,
      inconsistentTours: inconsistentTours.length,
      validatedLoadings: validatedLoadings.length,
      truckSales: truckSales.length,
      negativeTruckStockLevels: truckStockLevels.filter((level) => level.quantity < 0).length,
      duplicateStockLevels: duplicateStockLevels.length,
    },
    inconsistentTours,
    multipleOpenToursForSameTruck: entriesWithMultiple(openByTruck).map(
      ([truckId, truckTours]) => ({
        truckId,
        tours: truckTours.map(minimalTour),
      }),
    ),
    multipleOpenToursForSameDriver: entriesWithMultiple(openByDriver).map(
      ([driverId, driverTours]) => ({
        driverId,
        tours: driverTours.map(minimalTour),
      }),
    ),
    loadedWithoutValidatedLoading: tours
      .filter((tour) => tour.status === "LOADED" && tour.loading?.status !== "VALIDATED")
      .map(minimalTour),
    inProgressWithoutValidatedLoading: tours
      .filter((tour) => tour.status === "IN_PROGRESS" && tour.loading?.status !== "VALIDATED")
      .map(minimalTour),
    validatedLoadingsWithoutMovements: validatedLoadings
      .filter((loading) => loading.movements.length === 0)
      .map(minimalLoading),
    validatedLoadingsWithMismatchedMovements: validatedLoadings
      .map((loading) => {
        const mismatches = loading.lines
          .map((line) => {
            const movedQuantity = loading.movements
              .filter((movement) => movement.productId === line.productId)
              .reduce((sum, movement) => sum + movement.quantity, 0);
            return movedQuantity === line.quantity
              ? null
              : {
                  productId: line.productId,
                  expectedQuantity: line.quantity,
                  movedQuantity,
                };
          })
          .filter((line): line is NonNullable<typeof line> => Boolean(line));
        return mismatches.length > 0
          ? { ...minimalLoading(loading), mismatches }
          : null;
      })
      .filter((loading): loading is NonNullable<typeof loading> => Boolean(loading)),
    truckSalesWithoutTour: truckSales
      .filter((sale) => !sale.tourId)
      .map(minimalSale),
    truckSalesWithoutValidatedLoading: truckSales
      .filter((sale) => !sale.tour?.loading || sale.tour.loading.status !== "VALIDATED")
      .map(minimalSale),
    negativeTruckStock: truckStockLevels
      .filter((level) => level.quantity < 0)
      .map((level) => ({
        id: level.id,
        truckId: level.location.truckId,
        locationCode: level.location.code,
        productId: level.productId,
        productReference: level.product.reference,
        productName: level.product.name,
        quantity: level.quantity,
        reservedQuantity: level.reservedQuantity,
      })),
    duplicateStockLevels,
  };

  console.log(JSON.stringify(report, null, 2));
}

async function getToursForAudit() {
  return prisma.tour.findMany({
    include: {
      depot: { select: { id: true, code: true, name: true } },
      truck: { select: { id: true, code: true, registration: true } },
      driver: {
        select: {
          id: true,
          employeeCode: true,
          truckId: true,
          user: { select: { fullName: true, email: true } },
        },
      },
      loading: {
        include: {
          lines: {
            select: {
              productId: true,
              quantity: true,
              product: { select: { reference: true, name: true } },
            },
          },
        },
      },
      sales: { select: { id: true } },
    },
    orderBy: [{ date: "desc" }, { code: "asc" }],
  });
}

async function getValidatedLoadingsForAudit() {
  return prisma.truckLoading.findMany({
    where: { status: "VALIDATED" },
    select: {
      id: true,
      loadingNumber: true,
      tourId: true,
      lines: { select: { productId: true, quantity: true } },
    },
  }).then(async (loadings) => {
    const movements = await prisma.stockMovement.findMany({
      where: {
        type: "TRUCK_LOADING",
        referenceId: { in: loadings.map((loading) => loading.id) },
      },
      select: { id: true, referenceId: true, productId: true, quantity: true },
    });
    return loadings.map((loading) => ({
      ...loading,
      movements: movements.filter((movement) => movement.referenceId === loading.id),
    }));
  });
}

async function getTruckSalesForAudit() {
  return prisma.sale.findMany({
    where: { origin: "TRUCK" },
    select: {
      id: true,
      invoiceNumber: true,
      tourId: true,
      driverId: true,
      truckId: true,
      createdAt: true,
      tour: {
        select: {
          id: true,
          code: true,
          loading: { select: { id: true, status: true } },
        },
      },
    },
  });
}

function buildTourInconsistency(
  tour: TourAuditRecord,
  truckStockLevels: {
    quantity: number;
    location: { truckId: string | null };
  }[],
) {
  const reasons: string[] = [];
  if (tour.status === "IN_PROGRESS" && tour.loading?.status !== "VALIDATED") {
    reasons.push("Tournee IN_PROGRESS sans chargement VALIDATED.");
  }
  if (tour.status === "LOADED" && tour.loading?.status !== "VALIDATED") {
    reasons.push("Tournee LOADED sans chargement VALIDATED.");
  }
  if (tour.driver.truckId && tour.driver.truckId !== tour.truckId) {
    reasons.push("Le chauffeur affecte n'est pas lie au camion de la tournee.");
  }
  if (reasons.length === 0) return null;

  const stockForTruck = truckStockLevels.filter(
    (level) => level.location.truckId === tour.truckId,
  );
  return {
    id: tour.id,
    code: tour.code,
    status: tour.status,
    date: tour.date.toISOString(),
    driver: {
      id: tour.driver.id,
      employeeCode: tour.driver.employeeCode,
      name: tour.driver.user.fullName,
      email: tour.driver.user.email,
    },
    truck: {
      id: tour.truck.id,
      code: tour.truck.code,
      registration: tour.truck.registration,
    },
    depot: tour.depot,
    loading: tour.loading
      ? {
          id: tour.loading.id,
          loadingNumber: tour.loading.loadingNumber,
          status: tour.loading.status,
          linesCount: tour.loading.lines.length,
        }
      : null,
    salesCount: tour.sales.length,
    startedAt: tour.startedAt?.toISOString() ?? null,
    returnedAt: tour.returnedAt?.toISOString() ?? null,
    currentTruckStock: {
      productsCount: stockForTruck.length,
      totalQuantity: stockForTruck.reduce((sum, level) => sum + level.quantity, 0),
      negativeLevelsCount: stockForTruck.filter((level) => level.quantity < 0).length,
    },
    reasons,
  };
}

function minimalTour(tour: TourAuditRecord) {
  return {
    id: tour.id,
    code: tour.code,
    status: tour.status,
    date: tour.date.toISOString(),
    driverId: tour.driverId,
    truckId: tour.truckId,
  };
}

function minimalLoading(loading: Awaited<ReturnType<typeof getValidatedLoadingsForAudit>>[number]) {
  return {
    id: loading.id,
    loadingNumber: loading.loadingNumber,
    tourId: loading.tourId,
    linesCount: loading.lines.length,
    movementsCount: loading.movements.length,
  };
}

function minimalSale(sale: Awaited<ReturnType<typeof getTruckSalesForAudit>>[number]) {
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    tourId: sale.tourId,
    driverId: sale.driverId,
    truckId: sale.truckId,
    createdAt: sale.createdAt.toISOString(),
    tourCode: sale.tour?.code ?? null,
    loadingStatus: sale.tour?.loading?.status ?? null,
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = keyFn(item);
    acc[key] = [...(acc[key] ?? []), item];
    return acc;
  }, {});
}

function entriesWithMultiple<T>(record: Record<string, T[]>) {
  return Object.entries(record).filter(([, items]) => items.length > 1);
}

function isOpenTourStatus(status: string) {
  return openTourStatuses.some((openStatus) => openStatus === status);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
