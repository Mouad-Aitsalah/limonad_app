import "server-only";

import { isWithinMoneyRange } from "@/lib/money";
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

/**
 * F8-D: the single gate every money-writing flow (createCounterSale,
 * createDriverSale, createPurchase, credit notes, payments, tour-closure
 * valorisations) calls right after computing an amount and before any
 * Prisma write. Every Sale/Purchase/CreditNote/Payment/TourClosure/
 * Discrepancy money column is `Decimal(12,2)` in Postgres - a value outside
 * [-9999999999.99, 9999999999.99] would otherwise reach the database as a
 * raw, unhandled overflow (Postgres 22003, surfaced by Prisma as P2010) deep
 * inside a transaction, rather than a clean business error. `label` is for
 * server-side diagnostics only (never included in the thrown message, which
 * stays generic on purpose - no internals leak to the client). Delegates the
 * actual comparison to lib/money.ts's Decimal-based `isWithinMoneyRange`, not
 * a fragile float one.
 */
export function assertMoneyRange(value: number, label: string): void {
  if (!isWithinMoneyRange(value)) {
    console.error(`[assertMoneyRange] out-of-range amount rejected: ${label}=${value}`);
    throw new OperationsServiceError(
      "Le montant calcule depasse la limite autorisee.",
      422,
    );
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
