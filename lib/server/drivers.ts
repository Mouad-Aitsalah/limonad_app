import "server-only";

import { prisma } from "@/lib/prisma";
import { AuthServiceError, getCurrentSessionUser } from "@/lib/server/auth";
import { mapTruckToDto, truckInclude } from "@/lib/server/trucks";
import type { DriverAssignmentDto, TruckDto } from "@/types/operations-dto";

/**
 * The truck currently assigned to the logged-in driver, for the /driver
 * home screen's "Mon camion" summary. Reuses the exact same include/mapper
 * as the admin /camions list (lib/server/trucks.ts) so both surfaces stay
 * in sync - returns null (never throws) when no truck is assigned, since
 * the home screen must degrade gracefully rather than error out.
 */
export async function getCurrentDriverTruck(): Promise<TruckDto | null> {
  const sessionUser = await getCurrentSessionUser();
  if (!sessionUser) {
    throw new AuthServiceError("Session introuvable.", 401);
  }
  if (sessionUser.role !== "driver" || !sessionUser.driverId) {
    throw new AuthServiceError("Compte chauffeur requis.", 403);
  }

  const driver = await prisma.driver.findUnique({
    where: { id: sessionUser.driverId },
    select: { truck: { include: truckInclude } },
  });

  return driver?.truck ? mapTruckToDto(driver.truck) : null;
}

export async function getDrivers(): Promise<DriverAssignmentDto[]> {
  return prisma.driver.findMany({
    select: {
      id: true,
      employeeCode: true,
      phone: true,
      active: true,
      truckId: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      truck: {
        select: {
          id: true,
          code: true,
          registration: true,
        },
      },
    },
    orderBy: [{ user: { fullName: "asc" } }, { employeeCode: "asc" }],
  });
}
