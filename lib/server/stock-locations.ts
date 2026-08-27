import "server-only";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { StockLocationDto } from "@/types/operations-dto";

const stockLocationInclude = {
  depot: { select: { name: true } },
  truck: { select: { code: true } },
};

type StockLocationRecord = Awaited<ReturnType<typeof getStockLocationRecordById>>;

export function mapStockLocationToDto(
  location: NonNullable<StockLocationRecord>,
): StockLocationDto {
  return {
    id: location.id,
    code: location.code,
    name: location.name,
    type: location.type,
    depotId: location.depotId,
    truckId: location.truckId,
    depotName: location.depot?.name ?? null,
    truckCode: location.truck?.code ?? null,
    active: location.active,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}

export async function getStockLocations(): Promise<StockLocationDto[]> {
  const currentUser = await requireOrganizationUser();
  const locations = await prisma.stockLocation.findMany({
    where: { organizationId: currentUser.organizationId },
    include: stockLocationInclude,
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
  return locations.map(mapStockLocationToDto);
}

export async function getStockLocationById(id: string): Promise<StockLocationDto> {
  const currentUser = await requireOrganizationUser();
  const location = await getStockLocationRecordById(id, currentUser.organizationId);
  if (!location) throw new OperationsServiceError("Emplacement introuvable.", 404);
  return mapStockLocationToDto(location);
}

export async function getDepotStockLocation(depotId: string): Promise<StockLocationDto> {
  const currentUser = await requireOrganizationUser();
  const location = await prisma.stockLocation.findFirst({
    where: { depotId, organizationId: currentUser.organizationId },
    include: stockLocationInclude,
  });
  if (!location) {
    throw new OperationsServiceError("Emplacement depot introuvable.", 404);
  }
  return mapStockLocationToDto(location);
}

export async function getTruckStockLocation(truckId: string): Promise<StockLocationDto> {
  const currentUser = await requireOrganizationUser();
  const location = await prisma.stockLocation.findFirst({
    where: { truckId, organizationId: currentUser.organizationId },
    include: stockLocationInclude,
  });
  if (!location) {
    throw new OperationsServiceError("Emplacement camion introuvable.", 404);
  }
  return mapStockLocationToDto(location);
}

async function getStockLocationRecordById(id: string, organizationId: string) {
  return prisma.stockLocation.findFirst({
    where: { id, organizationId },
    include: stockLocationInclude,
  });
}
