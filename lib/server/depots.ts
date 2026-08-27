import "server-only";

import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { DepotDto } from "@/types/operations-dto";

export class OperationsServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export function mapDepotToDto(depot: {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  phone: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DepotDto {
  return {
    id: depot.id,
    code: depot.code,
    name: depot.name,
    address: depot.address,
    city: depot.city,
    phone: depot.phone,
    active: depot.active,
    createdAt: depot.createdAt.toISOString(),
    updatedAt: depot.updatedAt.toISOString(),
  };
}

export async function getDepots(): Promise<DepotDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const depots = await prisma.depot.findMany({
    where: { organizationId: currentUser.organizationId },
    orderBy: { name: "asc" },
  });
  return depots.map(mapDepotToDto);
}

export async function getDepotById(id: string): Promise<DepotDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const depot = await prisma.depot.findFirst({
    where: { id, organizationId: currentUser.organizationId },
  });
  if (!depot) throw new OperationsServiceError("Depot introuvable.", 404);
  return mapDepotToDto(depot);
}
