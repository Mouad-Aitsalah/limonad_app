import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthServiceError, getCurrentSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import {
  assertSameOrganization,
  requireOrganizationUser,
} from "@/lib/server/organization-context";
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

/**
 * Same allowed roles as the sibling getTrucks() call on the /chargements
 * page that is this function's only caller today (lib/server/trucks.ts) -
 * kept identical so this fix does not change who can load that page.
 * organizationId always comes from the session, never the client, and is
 * always applied - a driver from another organization can never be
 * returned here.
 */
export async function getDrivers(): Promise<DriverAssignmentDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  return prisma.driver.findMany({
    where: { organizationId: currentUser.organizationId },
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

const driverAssignmentSelect = {
  id: true,
  employeeCode: true,
  active: true,
  truckId: true,
  user: { select: { id: true, fullName: true, email: true } },
  truck: { select: { id: true, code: true, registration: true } },
} satisfies Prisma.DriverSelect;

/**
 * Admin-only mutation: assigns (or, with truckId: null, clears) the truck a
 * driver currently drives. This sets the one existing Driver.truckId column
 * - the same column getCurrentDriverTruck() and every truck-scoped driver
 * screen (stock, tournee, ventes, GPS) already read - so nothing else needs
 * to change once it is set. No new relation, no schema change.
 *
 * Both the driver and the truck are re-fetched and checked against the
 * admin's own session organizationId (never a client-supplied one) before
 * anything is written, so an org-A admin can never reach into org B.
 */
export async function assignTruckToDriver(
  driverId: string,
  truckId: string | null,
): Promise<DriverAssignmentDto> {
  const currentUser = await requireOrganizationUser(["admin"]);

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, organizationId: true },
  });
  if (!driver) {
    throw new OperationsServiceError("Chauffeur introuvable.", 404);
  }
  assertSameOrganization(
    currentUser.organizationId,
    driver.organizationId,
    "Ce chauffeur n'appartient pas a votre organisation.",
  );

  if (truckId) {
    const truck = await prisma.truck.findUnique({
      where: { id: truckId },
      select: {
        id: true,
        organizationId: true,
        assignedDriver: { select: { id: true } },
      },
    });
    if (!truck) {
      throw new OperationsServiceError("Camion introuvable.", 404);
    }
    assertSameOrganization(
      currentUser.organizationId,
      truck.organizationId,
      "Ce camion n'appartient pas a votre organisation.",
    );
    // Driver.truckId is @unique in the schema, i.e. a truck can already only
    // ever have one active driver - this check just surfaces that existing
    // constraint with a clear message instead of a raw P2002.
    if (truck.assignedDriver && truck.assignedDriver.id !== driverId) {
      throw new OperationsServiceError(
        "Ce camion est deja affecte a un autre chauffeur.",
        409,
        { truckId: "Ce camion est deja affecte a un autre chauffeur." },
      );
    }
  }

  try {
    return await prisma.driver.update({
      where: { id: driverId },
      data: { truckId },
      select: driverAssignmentSelect,
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      // Race: the truck was assigned to another driver between our check
      // and the write.
      throw new OperationsServiceError(
        "Ce camion est deja affecte a un autre chauffeur.",
        409,
        { truckId: "Ce camion est deja affecte a un autre chauffeur." },
      );
    }
    throw error;
  }
}
