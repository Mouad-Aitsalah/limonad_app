import "server-only";

import {
  calculateSegmentedGpsDistanceMeters,
  splitGpsRouteIntoSegments,
} from "@/lib/gps/gps-utils";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/server/auth";
import type {
  TruckRouteDto,
  TruckRoutePointDto,
  TruckRoutesPageData,
  TruckRouteStatus,
  TruckRouteTimelineEventDto,
  TruckRouteTourOption,
  TruckRouteVisitDto,
  TruckRouteVisitStatus,
} from "@/types/truck-routes";

const allowedStatuses: TruckRouteStatus[] = [
  "DRAFT",
  "PREPARED",
  "LOADED",
  "IN_PROGRESS",
  "WAITING_FOR_CLOSURE",
  "CLOSED",
  "CANCELLED",
  "INTERRUPTED",
];

const statusLabels: Record<TruckRouteStatus, string> = {
  DRAFT: "Brouillon",
  PREPARED: "Preparee",
  LOADED: "Chargee",
  IN_PROGRESS: "En cours",
  WAITING_FOR_CLOSURE: "En attente de cloture",
  CLOSED: "Terminee",
  CANCELLED: "Annulee",
  INTERRUPTED: "Interrompue",
};

type TruckRoutesSearchParams = Record<string, string | string[] | undefined>;

export async function getTruckRoutesPageData(
  searchParams: TruckRoutesSearchParams,
): Promise<TruckRoutesPageData> {
  await requireSessionUser(["admin", "depot_manager"]);

  const requestedDate = parseDateParam(searchParams.date) ?? getTodayDateParam();
  const requestedTruckId = pickFirstValue(searchParams.truckId);
  const driverId = pickFirstValue(searchParams.driverId);
  const status = parseStatusParam(searchParams.status);
  const tourId = pickFirstValue(searchParams.tourId);

  const selectedTourSeed = tourId
    ? await prisma.tour.findUnique({
        where: { id: tourId },
        select: {
          id: true,
          date: true,
          truckId: true,
        },
      })
    : null;

  const date = selectedTourSeed
    ? formatDateParam(selectedTourSeed.date)
    : requestedDate;
  const truckId = requestedTruckId ?? selectedTourSeed?.truckId ?? null;

  const [trucks, drivers, tours] = await Promise.all([
    prisma.truck.findMany({
      select: {
        id: true,
        code: true,
        registration: true,
      },
      orderBy: { code: "asc" },
    }),
    prisma.driver.findMany({
      where: { active: true },
      select: {
        id: true,
        employeeCode: true,
        user: { select: { fullName: true } },
        truck: { select: { code: true, registration: true } },
      },
      orderBy: { user: { fullName: "asc" } },
    }),
    prisma.tour.findMany({
      where: {
        date: fromDateParam(date),
        ...(truckId ? { truckId } : {}),
        ...(driverId ? { driverId } : {}),
        ...(status ? { status } : {}),
      },
      select: {
        id: true,
        code: true,
        status: true,
        startedAt: true,
        returnedAt: true,
        truck: {
          select: {
            id: true,
            code: true,
            registration: true,
          },
        },
        driver: {
          select: {
            id: true,
            user: { select: { fullName: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { code: "asc" }],
    }),
  ]);

  const routeTours: TruckRouteTourOption[] = tours.map((tour) => ({
    id: tour.id,
    code: tour.code,
    truckId: tour.truck.id,
    driverId: tour.driver.id,
    truckLabel: `${tour.truck.code} - ${tour.truck.registration}`,
    driverName: tour.driver.user.fullName,
    status: tour.status as TruckRouteStatus,
    startedAt: tour.startedAt?.toISOString() ?? null,
    returnedAt: tour.returnedAt?.toISOString() ?? null,
  }));

  const selectedTour =
    routeTours.find((tour) => tour.id === tourId) ??
    routeTours[0] ??
    null;

  const route = selectedTour
    ? await getTourGpsHistory(selectedTour.id)
    : null;

  const message = resolvePageMessage({
    truckId,
    toursCount: routeTours.length,
    hasRoute: Boolean(route),
    hasGpsPoints: (route?.points.length ?? 0) > 0,
  });

  return {
    filters: {
      date,
      truckId,
      driverId,
      status,
      tourId: selectedTour?.id ?? null,
    },
    filterOptions: {
      trucks: trucks.map((truck) => ({
        id: truck.id,
        label: truck.code,
        secondary: truck.registration,
      })),
      drivers: drivers.map((driver) => ({
        id: driver.id,
        label: driver.user.fullName,
        secondary: driver.truck
          ? `${driver.truck.code} - ${driver.truck.registration}`
          : driver.employeeCode,
      })),
      statuses: allowedStatuses.map((value) => ({
        value,
        label: statusLabels[value],
      })),
      tours: routeTours,
    },
    route,
    message,
  };
}

export async function getTourGpsHistory(tourId: string): Promise<TruckRouteDto | null> {
  await requireSessionUser(["admin", "depot_manager"]);

  const tour = await prisma.tour.findUnique({
    where: { id: tourId },
    select: {
      id: true,
      code: true,
      date: true,
      status: true,
      startedAt: true,
      returnedAt: true,
      closedAt: true,
      truck: {
        select: {
          id: true,
          code: true,
          registration: true,
        },
      },
      driver: {
        select: {
          id: true,
          user: { select: { fullName: true } },
        },
      },
      locationPings: {
        select: {
          id: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          speed: true,
          heading: true,
          recordedAt: true,
        },
        orderBy: { recordedAt: "asc" },
      },
      customerVisits: {
        select: {
          customerId: true,
          status: true,
          firstDetectedAt: true,
          arrivedAt: true,
          completedAt: true,
          noSaleReason: true,
          customer: {
            select: {
              code: true,
              name: true,
              phone: true,
              address: true,
              city: true,
              latitude: true,
              longitude: true,
            },
          },
        },
      },
      sales: {
        where: { status: { not: "CANCELLED" } },
        select: {
          id: true,
          invoiceNumber: true,
          createdAt: true,
          customerId: true,
          totalTTC: true,
        },
      },
    },
  });

  if (!tour) {
    return null;
  }

  const rawPoints: TruckRoutePointDto[] = tour.locationPings.map((point) => ({
    id: point.id,
    latitude: point.latitude.toNumber(),
    longitude: point.longitude.toNumber(),
    accuracy: point.accuracy?.toNumber() ?? null,
    speed: point.speed?.toNumber() ?? null,
    heading: point.heading?.toNumber() ?? null,
    recordedAt: point.recordedAt.toISOString(),
  }));

  const sanitizedPoints = sanitizeGpsPoints(rawPoints);
  const salesByCustomerId = new Map<
    string,
    {
      saleCount: number;
      saleAmount: number;
      firstSaleAt: string | null;
      saleLabel: string | null;
    }
  >();

  for (const sale of tour.sales) {
    if (!sale.customerId) {
      continue;
    }

    const current = salesByCustomerId.get(sale.customerId) ?? {
      saleCount: 0,
      saleAmount: 0,
      firstSaleAt: null,
      saleLabel: null,
    };

    current.saleCount += 1;
    current.saleAmount += sale.totalTTC.toNumber();
    current.firstSaleAt = current.firstSaleAt ?? sale.createdAt.toISOString();
    current.saleLabel =
      current.saleCount === 1
        ? sale.invoiceNumber
        : `${current.saleCount} ventes`;

    salesByCustomerId.set(sale.customerId, current);
  }

  const visitIds = new Set<string>();
  const visits: TruckRouteVisitDto[] = [];

  for (const visit of tour.customerVisits) {
    visitIds.add(visit.customerId);
    const salesInfo = salesByCustomerId.get(visit.customerId);
    visits.push({
      customerId: visit.customerId,
      customerCode: visit.customer.code,
      customerName: visit.customer.name,
      phone: visit.customer.phone,
      address: visit.customer.address,
      city: visit.customer.city,
      latitude: visit.customer.latitude?.toNumber() ?? null,
      longitude: visit.customer.longitude?.toNumber() ?? null,
      status: mapVisitStatus(visit.status, salesInfo?.saleCount ?? 0),
      firstDetectedAt: visit.firstDetectedAt?.toISOString() ?? null,
      arrivedAt: visit.arrivedAt?.toISOString() ?? null,
      completedAt: visit.completedAt?.toISOString() ?? null,
      noSaleReason: visit.noSaleReason ?? null,
      saleCount: salesInfo?.saleCount ?? 0,
      saleAmount: roundMoney(salesInfo?.saleAmount ?? 0),
      saleLabel: salesInfo?.saleLabel ?? null,
    });
  }

  if (salesByCustomerId.size > 0) {
    const missingCustomerIds = [...salesByCustomerId.keys()].filter(
      (customerId) => !visitIds.has(customerId),
    );

    if (missingCustomerIds.length > 0) {
      const saleCustomers = await prisma.customer.findMany({
        where: { id: { in: missingCustomerIds } },
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
      });

      for (const customer of saleCustomers) {
        const salesInfo = salesByCustomerId.get(customer.id);
        if (!salesInfo) {
          continue;
        }

        visits.push({
          customerId: customer.id,
          customerCode: customer.code,
          customerName: customer.name,
          phone: customer.phone,
          address: customer.address,
          city: customer.city,
          latitude: customer.latitude?.toNumber() ?? null,
          longitude: customer.longitude?.toNumber() ?? null,
          status: "DELIVERED",
          firstDetectedAt: null,
          arrivedAt: null,
          completedAt: salesInfo.firstSaleAt,
          noSaleReason: null,
          saleCount: salesInfo.saleCount,
          saleAmount: roundMoney(salesInfo.saleAmount),
          saleLabel: salesInfo.saleLabel,
        });
      }
    }
  }

  visits.sort((left, right) => {
    const leftTime = getVisitTimestamp(left) ?? "";
    const rightTime = getVisitTimestamp(right) ?? "";
    return leftTime.localeCompare(rightTime) || left.customerName.localeCompare(right.customerName);
  });

  const totalDistanceKm = roundDistance(
    calculateRouteDistanceMeters(sanitizedPoints) / 1000,
  );
  const timeline = buildTimeline(tour, visits);
  const pointsStart = sanitizedPoints[0] ?? rawPoints[0] ?? null;
  const pointsEnd =
    sanitizedPoints[sanitizedPoints.length - 1] ?? rawPoints[rawPoints.length - 1] ?? null;

  return {
    tour: {
      id: tour.id,
      code: tour.code,
      date: tour.date.toISOString(),
      status: tour.status as TruckRouteStatus,
      startedAt: tour.startedAt?.toISOString() ?? pointsStart?.recordedAt ?? null,
      returnedAt: tour.returnedAt?.toISOString() ?? pointsEnd?.recordedAt ?? null,
      closedAt: tour.closedAt?.toISOString() ?? null,
    },
    truck: {
      id: tour.truck.id,
      code: tour.truck.code,
      registration: tour.truck.registration,
    },
    driver: {
      id: tour.driver.id,
      name: tour.driver.user.fullName,
    },
    points: sanitizedPoints.length > 0 ? sanitizedPoints : rawPoints,
    visits,
    timeline,
    summary: {
      distanceKm: totalDistanceKm,
      durationMinutes: calculateDurationMinutes(
        tour.startedAt?.toISOString() ?? pointsStart?.recordedAt ?? null,
        tour.returnedAt?.toISOString() ?? pointsEnd?.recordedAt ?? null,
      ),
      pointsCount: rawPoints.length,
      usablePointsCount: sanitizedPoints.length,
      ignoredPointsCount: Math.max(rawPoints.length - sanitizedPoints.length, 0),
      clientsVisited: visits.length,
      deliveredCount: visits.filter((visit) => visit.status === "DELIVERED").length,
      salesCount: tour.sales.length,
      salesAmount: roundMoney(
        tour.sales.reduce((sum, sale) => sum + sale.totalTTC.toNumber(), 0),
      ),
      startedAt: tour.startedAt?.toISOString() ?? pointsStart?.recordedAt ?? null,
      returnedAt: tour.returnedAt?.toISOString() ?? pointsEnd?.recordedAt ?? null,
      status: tour.status as TruckRouteStatus,
    },
  };
}

export function getTruckRouteStatusLabel(status: TruckRouteStatus) {
  return statusLabels[status];
}

function resolvePageMessage({
  truckId,
  toursCount,
  hasRoute,
  hasGpsPoints,
}: {
  truckId: string | null;
  toursCount: number;
  hasRoute: boolean;
  hasGpsPoints: boolean;
}) {
  if (!truckId) {
    return "Choisissez une date et un camion pour afficher un trajet.";
  }

  if (toursCount === 0) {
    return "Aucune tournee trouvee.";
  }

  if (!hasRoute) {
    return "Impossible de charger l'historique de cette tournee.";
  }

  if (!hasGpsPoints) {
    return "Aucun trajet GPS enregistre pour ce camion a cette date.";
  }

  return null;
}

function sanitizeGpsPoints(points: TruckRoutePointDto[]) {
  return splitGpsRouteIntoSegments(points).flat();
}

function calculateRouteDistanceMeters(points: TruckRoutePointDto[]) {
  return calculateSegmentedGpsDistanceMeters(points);
}

function calculateDurationMinutes(start: string | null, end: string | null) {
  if (!start || !end) {
    return null;
  }

  const value =
    (new Date(end).getTime() - new Date(start).getTime()) / 1000 / 60;
  return value > 0 ? Math.round(value) : null;
}

function buildTimeline(
  tour: {
    id: string;
    startedAt: Date | null;
    returnedAt: Date | null;
    status: string;
  },
  visits: TruckRouteVisitDto[],
) {
  const events: TruckRouteTimelineEventDto[] = [];

  if (tour.startedAt) {
    events.push({
      id: `${tour.id}-start`,
      type: "START",
      timestamp: tour.startedAt.toISOString(),
      title: "Depart",
      subtitle: "Debut de la tournee",
      status: tour.status as TruckRouteStatus,
    });
  }

  for (const visit of visits) {
    const timestamp = getVisitTimestamp(visit);
    if (!timestamp) {
      continue;
    }

    events.push({
      id: `${tour.id}-${visit.customerId}`,
      type: "VISIT",
      timestamp,
      title: visit.customerName,
      subtitle: resolveVisitSubtitle(visit),
      status: visit.status,
      amount: visit.saleAmount > 0 ? visit.saleAmount : null,
    });
  }

  if (tour.returnedAt) {
    events.push({
      id: `${tour.id}-return`,
      type: "RETURN",
      timestamp: tour.returnedAt.toISOString(),
      title: "Retour",
      subtitle: "Retour du camion",
      status: tour.status as TruckRouteStatus,
    });
  }

  return events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function resolveVisitSubtitle(visit: TruckRouteVisitDto) {
  switch (visit.status) {
    case "DELIVERED":
      return "Livre";
    case "NO_SALE":
      return visit.noSaleReason || "Sans vente";
    case "ARRIVED":
      return "Arrivee confirmee";
    case "NEARBY":
      return "Client proche";
    default:
      return "A visiter";
  }
}

function getVisitTimestamp(visit: TruckRouteVisitDto) {
  return (
    visit.arrivedAt ??
    visit.completedAt ??
    visit.firstDetectedAt ??
    null
  );
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundDistance(value: number) {
  return Math.round(value * 10) / 10;
}

function mapVisitStatus(
  status: string,
  saleCount: number,
): TruckRouteVisitStatus {
  if (saleCount > 0) {
    return "DELIVERED";
  }

  switch (status) {
    case "NEARBY":
      return "NEARBY";
    case "ARRIVED":
      return "ARRIVED";
    case "DELIVERED":
      return "DELIVERED";
    case "NO_SALE":
      return "NO_SALE";
    default:
      return "PENDING";
  }
}

function pickFirstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function parseStatusParam(value: string | string[] | undefined) {
  const normalized = pickFirstValue(value);
  if (!normalized) {
    return null;
  }

  return allowedStatuses.includes(normalized as TruckRouteStatus)
    ? (normalized as TruckRouteStatus)
    : null;
}

function parseDateParam(value: string | string[] | undefined) {
  const normalized = pickFirstValue(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function fromDateParam(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function getTodayDateParam() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDateParam(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
