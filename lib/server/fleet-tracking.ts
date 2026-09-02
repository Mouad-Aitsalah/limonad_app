import "server-only";

import { classifyFleetGpsStatus } from "@/lib/gps/gps-utils";
import { roundMoney as roundMoneyDecimal } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { FleetSnapshotDto, FleetTruckDto } from "@/types/fleet-tracking";

/**
 * Admin live fleet monitoring - the "C. monitoring" side of the GPS
 * architecture (A. driver capture in hooks/use-driver-geolocation.ts /
 * DriverRuntimeProvider, B. storage as TourLocationPing via
 * recordDriverLocationForDriver). This module only ever READS what the
 * driver side already wrote - it captures nothing and never talks to a
 * phone directly.
 *
 * Polled by the admin's browser every few seconds (see
 * hooks/use-fleet-tracking.ts). Deliberately lightweight: one truck row per
 * currently in-progress tour, each truck's single latest GPS ping (not its
 * whole history - see lib/server/truck-routes.ts#getTourGpsHistory for the
 * full historical route, loaded separately and only on demand) plus cheap
 * count/sum aggregates for the tour's live stats.
 */
export async function getFleetSnapshot(): Promise<FleetSnapshotDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager"]);

  const tours = await prisma.tour.findMany({
    where: { organizationId: currentUser.organizationId, status: "IN_PROGRESS" },
    select: {
      id: true,
      code: true,
      truck: { select: { id: true, code: true, registration: true } },
      driver: { select: { id: true, user: { select: { fullName: true } } } },
    },
    orderBy: { truck: { code: "asc" } },
  });

  const trucks: FleetTruckDto[] = await Promise.all(
    tours.map(async (tour) => {
      const [latestPing, clientsVisited, salesAggregate] = await Promise.all([
        prisma.tourLocationPing.findFirst({
          where: { tourId: tour.id },
          orderBy: { recordedAt: "desc" },
          select: {
            latitude: true,
            longitude: true,
            accuracy: true,
            heading: true,
            speed: true,
            recordedAt: true,
          },
        }),
        prisma.tourCustomerVisit.count({
          where: { tourId: tour.id, status: { in: ["ARRIVED", "DELIVERED", "NO_SALE"] } },
        }),
        prisma.sale.aggregate({
          where: { tourId: tour.id, status: { not: "CANCELLED" } },
          _sum: { totalTTC: true },
          _count: { _all: true },
        }),
      ]);

      const position = latestPing
        ? {
            latitude: latestPing.latitude.toNumber(),
            longitude: latestPing.longitude.toNumber(),
            accuracy: latestPing.accuracy?.toNumber() ?? null,
            heading: latestPing.heading?.toNumber() ?? null,
            speed: latestPing.speed?.toNumber() ?? null,
            recordedAt: latestPing.recordedAt.toISOString(),
          }
        : null;

      return {
        tourId: tour.id,
        tourCode: tour.code,
        truckId: tour.truck.id,
        truckCode: tour.truck.code,
        truckRegistration: tour.truck.registration,
        driverId: tour.driver.id,
        driverName: tour.driver.user.fullName,
        position,
        gpsStatus: classifyFleetGpsStatus(position?.recordedAt ?? null),
        clientsVisited,
        salesCount: salesAggregate._count._all,
        salesAmount: roundMoney(salesAggregate._sum.totalTTC?.toNumber() ?? 0),
      };
    }),
  );

  return { trucks, serverTime: new Date().toISOString() };
}

// F8-C: applied only to salesAmount (real money) - never to the
// latitude/longitude/accuracy/heading/speed GPS fields above, which are
// never rounded here at all (full Decimal precision preserved). Delegates
// to the shared decimal-based engine (lib/money.ts).
function roundMoney(value: number) {
  return roundMoneyDecimal(value);
}
