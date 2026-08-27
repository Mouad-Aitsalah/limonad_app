import "server-only";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
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
  const locations = await prisma.stockLocation.findMany({
    include: stockLocationInclude,
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
  return locations.map(mapStockLocationToDto);
}

export async function getStockLocationById(id: string): Promise<StockLocationDto> {
  const location = await getStockLocationRecordById(id);
  if (!location) throw new OperationsServiceError("Emplacement introuvable.", 404);
  return mapStockLocationToDto(location);
}

export async function getDepotStockLocation(depotId: string): Promise<StockLocationDto> {
  const location = await prisma.stockLocation.findUnique({
    where: { depotId },
    include: stockLocationInclude,
  });
  if (!location) {
    throw new OperationsServiceError("Emplacement depot introuvable.", 404);
  }
  return mapStockLocationToDto(location);
}

export async function getTruckStockLocation(truckId: string): Promise<StockLocationDto> {
  const location = await prisma.stockLocation.findUnique({
    where: { truckId },
    include: stockLocationInclude,
  });
  if (!location) {
    throw new OperationsServiceError("Emplacement camion introuvable.", 404);
  }
  return mapStockLocationToDto(location);
}

async function getStockLocationRecordById(id: string) {
  return prisma.stockLocation.findUnique({
    where: { id },
    include: stockLocationInclude,
  });
}
