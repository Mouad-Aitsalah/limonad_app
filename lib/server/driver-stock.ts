import "server-only";

import { prisma } from "@/lib/prisma";
import { AuthServiceError, getCurrentSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getStockLevelsByLocation } from "@/lib/server/stock-levels";
import type { CurrentUser } from "@/types/auth";
import type { StockLevelDto } from "@/types/operations-dto";

export type DriverTruckStockDto = {
  sessionUser: CurrentUser;
  driver: {
    id: string;
    employeeCode: string;
    phone?: string | null;
    active: boolean;
  };
  truck: {
    id: string;
    code: string;
    registration: string;
    brand?: string | null;
    model?: string | null;
    capacity?: number | null;
    status: string;
  };
  location: {
    id: string;
    code: string;
    name: string;
    type: "TRUCK";
  };
  levels: StockLevelDto[];
};

export async function getCurrentDriverTruckStock(): Promise<DriverTruckStockDto> {
  const sessionUser = await getCurrentSessionUser();

  if (!sessionUser) {
    throw new AuthServiceError("Session introuvable.", 401);
  }

  if (sessionUser.role !== "driver" || !sessionUser.driverId) {
    throw new AuthServiceError("Compte chauffeur requis.", 403);
  }

  const driver = await prisma.driver.findUnique({
    where: { id: sessionUser.driverId },
    select: {
      id: true,
      employeeCode: true,
      phone: true,
      active: true,
      truck: {
        select: {
          id: true,
          code: true,
          registration: true,
          brand: true,
          model: true,
          capacity: true,
          status: true,
          stockLocation: {
            select: {
              id: true,
              code: true,
              name: true,
              type: true,
            },
          },
        },
      },
    },
  });

  if (!driver || !driver.active) {
    throw new OperationsServiceError("Profil chauffeur introuvable ou inactif.", 404);
  }

  if (!driver.truck) {
    throw new OperationsServiceError("Aucun camion n'est affecte a votre compte.", 404);
  }

  if (!driver.truck.stockLocation || driver.truck.stockLocation.type !== "TRUCK") {
    throw new OperationsServiceError("Emplacement de stock camion introuvable.", 404);
  }

  const levels = await getStockLevelsByLocation(driver.truck.stockLocation.id);

  return {
    sessionUser,
    driver: {
      id: driver.id,
      employeeCode: driver.employeeCode,
      phone: driver.phone,
      active: driver.active,
    },
    truck: {
      id: driver.truck.id,
      code: driver.truck.code,
      registration: driver.truck.registration,
      brand: driver.truck.brand,
      model: driver.truck.model,
      capacity: driver.truck.capacity,
      status: driver.truck.status,
    },
    location: {
      id: driver.truck.stockLocation.id,
      code: driver.truck.stockLocation.code,
      name: driver.truck.stockLocation.name,
      type: "TRUCK",
    },
    levels,
  };
}
