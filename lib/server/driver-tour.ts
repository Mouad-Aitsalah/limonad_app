import "server-only";

import { z } from "zod";

import { GPS_GAP_MS, GPS_MAX_FUTURE_DRIFT_MS, GPS_MAX_TRUCK_SPEED_KMH } from "@/lib/gps/gps-config";
import { detectGpsStops } from "@/lib/gps/gps-stop-detection";
import {
  calculateDistanceMeters,
  calculateSegmentedGpsDistanceMeters,
  hasAcceptableAccuracy,
  isGpsPointReliable,
  splitGpsRouteIntoSegments,
} from "@/lib/gps/gps-utils";
import { prisma } from "@/lib/prisma";
import { AuthServiceError, requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getLoadingByTourId } from "@/lib/server/truck-loadings";
import {
  getActiveTourForDriver,
  getTodayTourDate,
  requireActiveTourForDriver,
} from "@/lib/server/tours";
import type {
  CurrentDriverTourDto,
  DriverTourStartContextDto,
  DriverTourCustomerDto,
  DriverTourPositionDto,
  DriverTourProximityDto,
  DriverTourSummaryDto,
  TourDto,
} from "@/types/operations-dto";

const proximityThresholdMeters = 150;

const locationPingSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).nullable().optional(),
  speed: z.coerce.number().min(0).nullable().optional(),
  heading: z.coerce.number().min(0).max(360).nullable().optional(),
  recordedAt: z.coerce.date().optional(),
});

const noSaleSchema = z.object({
  reason: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional(),
});

type VisitDbClient = Pick<typeof prisma, "tourCustomerVisit">;

export async function getCurrentDriverTour(): Promise<CurrentDriverTourDto> {
  const user = await requireDriverUser();

  const activeTour = await getActiveTourForDriver(user.driverId);
  if (!activeTour) {
    const startContext = await getDriverTourStartContext(user.driverId);
    const existingDailyTour = await findDriverDailyTour(user.driverId, startContext.truck.id);

    return emptyCurrentTour(
      existingDailyTour
        ? buildDailyTourMessage(existingDailyTour)
        : "Aucune tournee active.",
      startContext,
      existingDailyTour ? resolveCanStartDailyTour(existingDailyTour) : true,
    );
  }

  return buildCurrentDriverTourState(user.driverId, activeTour);
}

export async function requireCurrentDriverTour(): Promise<TourDto> {
  const user = await requireDriverUser();
  return requireActiveTourForDriver(user.driverId);
}

export async function recordCurrentDriverLocation(
  input: unknown,
): Promise<{ currentTour: CurrentDriverTourDto; point: DriverTourPositionDto }> {
  const user = await requireDriverUser();
  const data = locationPingSchema.parse(input);
  const tour = await requireActiveTourForDriver(user.driverId);
  const recordedAt = data.recordedAt ?? new Date();
  const receivedAt = new Date();
  const nextPoint = {
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: data.accuracy ?? null,
    recordedAt: recordedAt.toISOString(),
  };

  if (tour.status !== "IN_PROGRESS") {
    throw new OperationsServiceError(
      "Le suivi GPS ne peut demarrer qu'une fois la tournee commencée.",
      409,
    );
  }

  if (!hasAcceptableAccuracy(nextPoint)) {
    throw new OperationsServiceError("Position GPS trop imprecise.", 422);
  }

  const capturedAgeMs = receivedAt.getTime() - recordedAt.getTime();
  if (
    capturedAgeMs < -GPS_MAX_FUTURE_DRIFT_MS ||
    !isGpsPointReliable(nextPoint, receivedAt.getTime())
  ) {
    throw new OperationsServiceError("Position GPS trop ancienne ou indisponible.", 422);
  }

  const previousPing = await prisma.tourLocationPing.findFirst({
    where: { tourId: tour.id },
    select: {
      latitude: true,
      longitude: true,
      recordedAt: true,
    },
    orderBy: { recordedAt: "desc" },
  });

  if (previousPing) {
    const previousPoint = {
      latitude: previousPing.latitude.toNumber(),
      longitude: previousPing.longitude.toNumber(),
      recordedAt: previousPing.recordedAt.toISOString(),
    };
    const elapsedMs = recordedAt.getTime() - previousPing.recordedAt.getTime();

    if (elapsedMs > 0 && elapsedMs <= GPS_GAP_MS) {
      const distanceMeters = calculateDistanceMeters(previousPoint, nextPoint);
      const speedKmh = (distanceMeters / (elapsedMs / 1000)) * 3.6;
      if (speedKmh > GPS_MAX_TRUCK_SPEED_KMH) {
        throw new OperationsServiceError("Point GPS ignore: deplacement impossible detecte.", 422);
      }
    }
  }

  await prisma.tourLocationPing.create({
    data: {
      tourId: tour.id,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy ?? null,
      speed: data.speed ?? null,
      heading: data.heading ?? null,
      recordedAt,
    },
  });

  await upsertNearbyVisit(user.driverId, tour.id, data.latitude, data.longitude);

  const point: DriverTourPositionDto = {
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: data.accuracy ?? null,
    speed: data.speed ?? null,
    heading: data.heading ?? null,
    recordedAt: recordedAt.toISOString(),
  };

  // A tour can accumulate thousands of GPS points; re-fetching and
  // re-serializing all of them on every single ping (every few seconds while
  // driving) would grow the response and the work done here without bound.
  // The caller already has the new point and appends it to its own route
  // locally, so the route history here is skipped - only a cheap count is
  // used for the summary's routePointCount.
  const currentTour = await buildCurrentDriverTourState(user.driverId, tour, {
    skipRouteHistory: true,
    latestPositionOverride: point,
  });

  return { currentTour, point };
}

export async function confirmCurrentDriverArrival(
  customerId: string,
): Promise<CurrentDriverTourDto> {
  const user = await requireDriverUser();
  const tour = await requireActiveTourForDriver(user.driverId);

  if (tour.status !== "IN_PROGRESS") {
    throw new OperationsServiceError("La tournee doit etre en cours pour confirmer une arrivee.", 409);
  }

  const customer = await getAccessibleDriverCustomer(user.driverId, customerId);
  const latestPing = await prisma.tourLocationPing.findFirst({
    where: { tourId: tour.id },
    orderBy: { recordedAt: "desc" },
    select: { latitude: true, longitude: true, accuracy: true, recordedAt: true },
  });
  const latestPoint = latestPing
    ? {
        latitude: latestPing.latitude.toNumber(),
        longitude: latestPing.longitude.toNumber(),
        accuracy: latestPing.accuracy?.toNumber() ?? null,
        recordedAt: latestPing.recordedAt.toISOString(),
      }
    : null;

  const distanceMeters =
    latestPoint &&
    isGpsPointReliable(latestPoint) &&
    customer.latitude !== null &&
    customer.longitude !== null
      ? calculateDistanceMeters(latestPoint, {
          latitude: customer.latitude.toNumber(),
          longitude: customer.longitude.toNumber(),
        })
      : null;

  const now = new Date();
  const existingVisit = await prisma.tourCustomerVisit.findUnique({
    where: {
      tourId_customerId: {
        tourId: tour.id,
        customerId,
      },
    },
    select: { firstDetectedAt: true },
  });

  await prisma.tourCustomerVisit.upsert({
    where: {
      tourId_customerId: {
        tourId: tour.id,
        customerId,
      },
    },
    update: {
      status: "ARRIVED",
      arrivedAt: now,
      noSaleReason: null,
      lastKnownDistanceMeters: distanceMeters,
    },
    create: {
      tourId: tour.id,
      customerId,
      status: "ARRIVED",
      firstDetectedAt: existingVisit?.firstDetectedAt ?? now,
      arrivedAt: now,
      lastKnownDistanceMeters: distanceMeters,
    },
  });

  return buildCurrentDriverTourState(user.driverId, tour);
}

export async function markCurrentDriverNoSale(
  customerId: string,
  input: unknown,
): Promise<CurrentDriverTourDto> {
  const user = await requireDriverUser();
  const tour = await requireActiveTourForDriver(user.driverId);

  if (tour.status !== "IN_PROGRESS") {
    throw new OperationsServiceError("La tournee doit etre en cours pour enregistrer une visite.", 409);
  }

  const customer = await getAccessibleDriverCustomer(user.driverId, customerId);
  const data = noSaleSchema.parse(input);
  const now = new Date();

  await prisma.tourCustomerVisit.upsert({
    where: {
      tourId_customerId: {
        tourId: tour.id,
        customerId,
      },
    },
    update: {
      status: "NO_SALE",
      completedAt: now,
      noSaleReason: data.reason ?? "Aucune vente",
    },
    create: {
      tourId: tour.id,
      customerId: customer.id,
      status: "NO_SALE",
      firstDetectedAt: now,
      arrivedAt: now,
      completedAt: now,
      noSaleReason: data.reason ?? "Aucune vente",
    },
  });

  return buildCurrentDriverTourState(user.driverId, tour);
}

export async function markCustomerDeliveredOnTour(
  tx: VisitDbClient,
  tourId: string,
  customerId: string,
) {
  const existingVisit = await tx.tourCustomerVisit.findUnique({
    where: {
      tourId_customerId: {
        tourId,
        customerId,
      },
    },
    select: {
      firstDetectedAt: true,
      arrivedAt: true,
    },
  });

  const now = new Date();

  if (existingVisit) {
    await tx.tourCustomerVisit.update({
      where: {
        tourId_customerId: {
          tourId,
          customerId,
        },
      },
      data: {
        status: "DELIVERED",
        arrivedAt: existingVisit.arrivedAt ?? null,
        completedAt: now,
        noSaleReason: null,
      },
    });
    return;
  }

  await tx.tourCustomerVisit.create({
    data: {
      tourId,
      customerId,
      status: "DELIVERED",
      firstDetectedAt: now,
      completedAt: now,
    },
  });
}

async function buildCurrentDriverTourState(
  driverId: string,
  baseTour: TourDto,
  options?: {
    /**
     * Skips the tourLocationPing.findMany history fetch (unbounded and
     * growing for the whole tour) — used for the per-ping "record location"
     * response, where the caller already has the new point and appends it to
     * its own client-side route instead of receiving the full history again.
     * Only a cheap count() is used for the summary's point count.
     */
    skipRouteHistory?: boolean;
    /** The just-recorded point, used as the last known/latest position when history is skipped. */
    latestPositionOverride?: DriverTourPositionDto;
  },
): Promise<CurrentDriverTourDto> {
  const tour = await hydrateTourLoading(baseTour);
  const skipRouteHistory = options?.skipRouteHistory ?? false;

  const [customers, visits, pingsOrCount, sales] = await Promise.all([
    prisma.customer.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: driverId }],
      },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        latitude: true,
        longitude: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.tourCustomerVisit.findMany({
      where: { tourId: tour.id },
      orderBy: { updatedAt: "desc" },
    }),
    skipRouteHistory
      ? prisma.tourLocationPing.count({ where: { tourId: tour.id } })
      : prisma.tourLocationPing.findMany({
          where: { tourId: tour.id },
          orderBy: { recordedAt: "asc" },
        }),
    prisma.sale.findMany({
      where: {
        tourId: tour.id,
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        customerId: true,
        totalTTC: true,
      },
    }),
  ]);

  const pointCount = typeof pingsOrCount === "number" ? pingsOrCount : pingsOrCount.length;
  const rawRoute: DriverTourPositionDto[] = typeof pingsOrCount === "number"
    ? []
    : pingsOrCount.map((ping) => ({
        latitude: ping.latitude.toNumber(),
        longitude: ping.longitude.toNumber(),
        accuracy: ping.accuracy?.toNumber() ?? null,
        speed: ping.speed?.toNumber() ?? null,
        heading: ping.heading?.toNumber() ?? null,
        recordedAt: ping.recordedAt.toISOString(),
      }));
  const route = splitGpsRouteIntoSegments(rawRoute).flat();

  const lastKnownPosition = skipRouteHistory
    ? (options?.latestPositionOverride ?? null)
    : (route.at(-1) ?? null);
  const latestPosition =
    lastKnownPosition && isGpsPointReliable(lastKnownPosition) ? lastKnownPosition : null;
  const visitsByCustomerId = new Map(visits.map((visit) => [visit.customerId, visit]));
  const deliveredCustomerIds = new Set(
    sales.map((sale) => sale.customerId).filter((value): value is string => Boolean(value)),
  );

  const driverCustomers: DriverTourCustomerDto[] = customers.map((customer) => {
    const visit = visitsByCustomerId.get(customer.id);
    const latitude = customer.latitude?.toNumber() ?? null;
    const longitude = customer.longitude?.toNumber() ?? null;
    const distanceMeters =
      latestPosition && latitude !== null && longitude !== null
        ? calculateDistanceMeters(latestPosition, { latitude, longitude })
        : null;

    const visitStatus = deliveredCustomerIds.has(customer.id)
      ? "DELIVERED"
      : visit
        ? mapVisitStatus(visit.status)
        : "PENDING";

    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      city: customer.city,
      latitude,
      longitude,
      distanceMeters,
      visitStatus,
      lastEventAt:
        visit?.completedAt?.toISOString() ??
        visit?.arrivedAt?.toISOString() ??
        visit?.firstDetectedAt?.toISOString() ??
        null,
      noSaleReason: visit?.noSaleReason ?? null,
    };
  });

  driverCustomers.sort((left, right) => {
    const leftDistance = left.distanceMeters ?? Number.POSITIVE_INFINITY;
    const rightDistance = right.distanceMeters ?? Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance || left.name.localeCompare(right.name, "fr-FR");
  });

  const stops = skipRouteHistory ? [] : detectGpsStops(route);
  const proximity = resolveProximity(driverCustomers);
  const summary = buildTourSummary(tour, route, driverCustomers, sales, pointCount);

  return {
    tour,
    message: driverTourMessage(tour),
    canStart: tour.status === "LOADED" && tour.loading?.status === "VALIDATED",
    canReturn: tour.status === "IN_PROGRESS",
    customers: driverCustomers,
    route,
    stops,
    latestPosition,
    proximity,
    summary,
  };
}

async function hydrateTourLoading(tour: TourDto): Promise<TourDto> {
  const loading = await getLoadingByTourId(tour.id);
  return { ...tour, loading };
}

async function upsertNearbyVisit(
  driverId: string,
  tourId: string,
  latitude: number,
  longitude: number,
) {
  const customers = await prisma.customer.findMany({
    where: {
      status: "ACTIVE",
      latitude: { not: null },
      longitude: { not: null },
      OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: driverId }],
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
    },
  });

  const nearest = customers
    .map((customer) => ({
      id: customer.id,
      distanceMeters: calculateDistanceMeters(
        { latitude, longitude },
        {
          latitude: customer.latitude!.toNumber(),
          longitude: customer.longitude!.toNumber(),
        },
      ),
    }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters)[0];

  if (!nearest || nearest.distanceMeters > proximityThresholdMeters) {
    return;
  }

  const now = new Date();
  const existingVisit = await prisma.tourCustomerVisit.findUnique({
    where: {
      tourId_customerId: {
        tourId,
        customerId: nearest.id,
      },
    },
    select: {
      status: true,
      firstDetectedAt: true,
      arrivedAt: true,
      completedAt: true,
    },
  });

  if (existingVisit?.status === "DELIVERED" || existingVisit?.status === "NO_SALE") {
    await prisma.tourCustomerVisit.update({
      where: {
        tourId_customerId: {
          tourId,
          customerId: nearest.id,
        },
      },
      data: { lastKnownDistanceMeters: nearest.distanceMeters },
    });
    return;
  }

  await prisma.tourCustomerVisit.upsert({
    where: {
      tourId_customerId: {
        tourId,
        customerId: nearest.id,
      },
    },
    update: {
      status: existingVisit?.arrivedAt ? "ARRIVED" : "NEARBY",
      firstDetectedAt: existingVisit?.firstDetectedAt ?? now,
      lastKnownDistanceMeters: nearest.distanceMeters,
    },
    create: {
      tourId,
      customerId: nearest.id,
      status: "NEARBY",
      firstDetectedAt: now,
      lastKnownDistanceMeters: nearest.distanceMeters,
    },
  });
}

async function getAccessibleDriverCustomer(driverId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      status: "ACTIVE",
      OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: driverId }],
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
    },
  });

  if (!customer) {
    throw new OperationsServiceError("Client introuvable.", 404);
  }

  return customer;
}

async function findDriverDailyTour(driverId: string, truckId: string) {
  const tour = await prisma.tour.findUnique({
    where: {
      truckId_date: {
        truckId,
        date: getTodayTourDate(),
      },
    },
    select: {
      status: true,
      loading: {
        select: {
          status: true,
          stockAppliedAt: true,
        },
      },
      driverId: true,
    },
  });

  if (!tour || tour.driverId !== driverId) {
    return null;
  }

  return tour;
}

async function requireDriverUser() {
  const user = await requireSessionUser(["driver"]);
  const driverId = user.driverId;
  if (!driverId) {
    throw new AuthServiceError("Profil chauffeur introuvable.", 403);
  }

  return { ...user, driverId };
}

async function getDriverTourStartContext(
  driverId: string,
): Promise<DriverTourStartContextDto> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      active: true,
      user: { select: { fullName: true } },
      truck: {
        select: {
          id: true,
          code: true,
          registration: true,
          status: true,
          depot: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          stockLocation: {
            select: {
              id: true,
              active: true,
            },
          },
        },
      },
    },
  });

  if (!driver?.active) {
    throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  }

  if (!driver.truck) {
    throw new OperationsServiceError("Aucun camion n'est affecte a cet utilisateur.", 403);
  }

  let stockCurrentQuantity = 0;
  let productCount = 0;

  if (driver.truck.stockLocation?.active) {
    const aggregates = await prisma.stockLevel.aggregate({
      where: {
        locationId: driver.truck.stockLocation.id,
        quantity: { gt: 0 },
      },
      _sum: { quantity: true },
      _count: { productId: true },
    });

    stockCurrentQuantity = aggregates._sum.quantity ?? 0;
    productCount = aggregates._count.productId ?? 0;
  }

  return {
    date: getTodayTourDate().toISOString(),
    driver: {
      id: driver.id,
      name: driver.user.fullName,
    },
    truck: {
      id: driver.truck.id,
      code: driver.truck.code,
      registration: driver.truck.registration,
      status: driver.truck.status,
    },
    depot: driver.truck.depot,
    stockCurrentQuantity,
    productCount,
    warning:
      stockCurrentQuantity <= 0
        ? "Le stock camion est actuellement a zero. Vous pouvez demarrer la tournee, mais aucune vente ne sera possible sans stock."
        : null,
  };
}

function emptyCurrentTour(
  message: string,
  startContext: DriverTourStartContextDto | null = null,
  canStart = false,
): CurrentDriverTourDto {
  return {
    tour: null,
    message,
    startContext,
    canStart,
    canReturn: false,
    customers: [],
    route: [],
    stops: [],
    latestPosition: null,
    proximity: null,
    summary: null,
  };
}

function resolveCanStartDailyTour(
  tour: Awaited<ReturnType<typeof findDriverDailyTour>>,
) {
  if (!tour) {
    return false;
  }

  if (
    tour.status === "WAITING_FOR_CLOSURE" ||
    tour.status === "CLOSED" ||
    tour.status === "CANCELLED" ||
    tour.status === "INTERRUPTED"
  ) {
    return false;
  }

  if (!tour.loading) {
    return false;
  }

  return (
    tour.loading.status === "VALIDATED" ||
    (tour.loading.status === "DRAFT" && Boolean(tour.loading.stockAppliedAt))
  );
}

function buildDailyTourMessage(
  tour: NonNullable<Awaited<ReturnType<typeof findDriverDailyTour>>>,
) {
  if (!tour.loading) {
    return "Aucune fiche de chargement n'existe pour ce camion aujourd'hui.";
  }

  if (tour.status === "WAITING_FOR_CLOSURE" || tour.status === "CLOSED") {
    return "La tournee du jour est deja terminee pour ce camion.";
  }

  if (tour.status === "CANCELLED" || tour.status === "INTERRUPTED") {
    return "La fiche journaliere du jour ne peut pas etre relancee.";
  }

  if (tour.loading.status === "VALIDATED") {
    return "La fiche journaliere du jour existe deja. Vous pouvez commencer la tournee.";
  }

  if (tour.loading.status === "DRAFT" && tour.loading.stockAppliedAt) {
    return "La fiche journaliere du jour existe deja. Le stock est deja applique au camion, vous pouvez commencer la tournee.";
  }

  return "Le chargement doit etre valide avant de commencer la tournee.";
}

function buildTourSummary(
  tour: TourDto,
  route: DriverTourPositionDto[],
  customers: DriverTourCustomerDto[],
  sales: Array<{ id: string; customerId: string | null; totalTTC: { toNumber(): number } }>,
  routePointCountOverride?: number,
): DriverTourSummaryDto {
  const distanceMeters = calculateSegmentedGpsDistanceMeters(route);

  const theoreticalStockQuantity =
    tour.stockSheet?.lines.reduce((sum, line) => sum + line.theoreticalQuantity, 0) ?? 0;
  const actualLines = tour.stockSheet?.lines.filter((line) => line.actualQuantity !== null && line.actualQuantity !== undefined) ?? [];
  const actualStockQuantity =
    actualLines.length > 0
      ? actualLines.reduce((sum, line) => sum + (line.actualQuantity ?? 0), 0)
      : null;
  const discrepancyQuantity =
    actualLines.length > 0
      ? actualLines.reduce((sum, line) => sum + (line.differenceQuantity ?? 0), 0)
      : null;

  return {
    routePointCount: routePointCountOverride ?? route.length,
    distanceMeters: roundMetric(distanceMeters),
    customersNearby: customers.filter((customer) => customer.visitStatus === "NEARBY").length,
    customersArrived: customers.filter((customer) => customer.visitStatus === "ARRIVED").length,
    customersDelivered: customers.filter((customer) => customer.visitStatus === "DELIVERED").length,
    customersNoSale: customers.filter((customer) => customer.visitStatus === "NO_SALE").length,
    salesCount: sales.length,
    totalSalesTTC: roundMetric(
      sales.reduce((sum, sale) => sum + sale.totalTTC.toNumber(), 0),
    ),
    theoreticalStockQuantity,
    stockCurrentQuantity: tour.stockSheet?.truckCurrentQuantity ?? 0,
    actualStockQuantity,
    discrepancyQuantity,
  };
}

function resolveProximity(
  customers: DriverTourCustomerDto[],
): DriverTourProximityDto | null {
  const nearest = customers
    .filter(
      (customer) =>
        customer.distanceMeters !== null &&
        customer.distanceMeters !== undefined &&
        customer.visitStatus !== "DELIVERED" &&
        customer.visitStatus !== "NO_SALE",
    )
    .sort((left, right) => (left.distanceMeters ?? Infinity) - (right.distanceMeters ?? Infinity))[0];

  const distanceMeters = nearest?.distanceMeters ?? null;

  if (!nearest || distanceMeters === null || distanceMeters > proximityThresholdMeters) {
    return null;
  }

  return {
    customerId: nearest.id,
    customerName: nearest.name,
    distanceMeters: roundMetric(distanceMeters),
  };
}

function mapVisitStatus(
  status: "NEARBY" | "ARRIVED" | "DELIVERED" | "NO_SALE",
): DriverTourCustomerDto["visitStatus"] {
  switch (status) {
    case "NEARBY":
      return "NEARBY";
    case "ARRIVED":
      return "ARRIVED";
    case "DELIVERED":
      return "DELIVERED";
    case "NO_SALE":
      return "NO_SALE";
  }
}

function driverTourMessage(tour: TourDto) {
  if (!tour.loading || tour.loading.status !== "VALIDATED") {
    return "Votre tournee est en preparation. Le chargement n'est pas encore valide.";
  }
  if (tour.status === "LOADED") {
    return "Votre chargement est pret. Vous pouvez demarrer la tournee.";
  }
  if (tour.status === "WAITING_FOR_CLOSURE") {
    return "Votre retour est enregistre. La tournee est en attente de cloture.";
  }
  if (tour.status === "IN_PROGRESS") {
    return "Votre tournee est en cours.";
  }
  throw new OperationsServiceError("Statut de tournee incompatible.", 409);
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}
