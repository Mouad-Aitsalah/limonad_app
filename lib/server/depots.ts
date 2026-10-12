import "server-only";

import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { DepotCreateInput, DepotDto } from "@/types/operations-dto";

// Moved unchanged to service-error.ts (testable without Next); re-exported here
// so every existing import keeps the same class.
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/service-error";
export { assertMoneyRange, OperationsServiceError };

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
  stockLocation?: { name: string; active: boolean } | null;
}): DepotDto {
  return {
    id: depot.id,
    code: depot.code,
    name: depot.name,
    address: depot.address,
    city: depot.city,
    phone: depot.phone,
    active: depot.active,
    stockLocationName: depot.stockLocation?.name ?? null,
    stockLocationActive: depot.stockLocation?.active ?? null,
    createdAt: depot.createdAt.toISOString(),
    updatedAt: depot.updatedAt.toISOString(),
  };
}

const depotInclude = {
  stockLocation: { select: { name: true, active: true } },
} satisfies Prisma.DepotInclude;

export async function getDepots(
  options: { activeOnly?: boolean } = {},
): Promise<DepotDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const depots = await prisma.depot.findMany({
    where: {
      organizationId: currentUser.organizationId,
      ...(options.activeOnly ? { active: true } : {}),
    },
    include: depotInclude,
    orderBy: { name: "asc" },
  });
  return depots.map(mapDepotToDto);
}

export async function getDepotById(id: string): Promise<DepotDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const depot = await prisma.depot.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    include: depotInclude,
  });
  if (!depot) throw new OperationsServiceError("Depot introuvable.", 404);
  return mapDepotToDto(depot);
}

const depotCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom du depot est obligatoire.").max(120),
});

/**
 * Creates a Depot AND its 1:1 DEPOT-type StockLocation in the caller's
 * transaction. `organizationId` is passed explicitly by the caller (from a
 * session or a just-created org) - never from client input. The depot code
 * comes from the per-org DepotCode sequence (DEP-001, DEP-002, ...); the
 * stock location reuses it as SL-DEP-001 so both stay unique per org
 * without a second sequence. Both rows are always `active: true`.
 *
 * Used by createOrganization() (to give every new org a working depot) and
 * by createDepot() (admin adding a depot to their own org).
 */
export async function provisionDepot(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    name: string;
    address?: string | null;
    city?: string | null;
  },
): Promise<{ id: string; code: string }> {
  const number = await reserveDocumentSequence(
    tx,
    params.organizationId,
    DocumentType.DepotCode,
  );
  const code = `DEP-${String(number).padStart(3, "0")}`;

  const depot = await tx.depot.create({
    data: {
      organizationId: params.organizationId,
      code,
      name: params.name,
      address: params.address ?? "",
      city: params.city ?? "",
      active: true,
    },
    select: { id: true, code: true },
  });

  await tx.stockLocation.create({
    data: {
      organizationId: params.organizationId,
      code: `SL-${code}`,
      name: params.name,
      type: "DEPOT",
      depotId: depot.id,
      active: true,
    },
  });

  return depot;
}

/**
 * Admin-only: add a depot (with its DEPOT stock location) to the admin's
 * OWN organization. The client only ever supplies `{ name }` - the server
 * forces organizationId = session.organizationId and active = true. Never
 * touches another organization.
 */
export async function createDepot(input: DepotCreateInput): Promise<DepotDto> {
  const currentUser = await requireOrganizationUser(["admin"]);

  const parsed = depotCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs du depot sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: currentUser.organizationId },
    select: { address: true, city: true },
  });

  try {
    const created = await prisma.$transaction((tx) =>
      provisionDepot(tx, {
        organizationId: currentUser.organizationId,
        name: parsed.data.name,
        address: organization.address,
        city: organization.city,
      }),
    );

    const depot = await prisma.depot.findUniqueOrThrow({
      where: { id: created.id },
      include: depotInclude,
    });
    return mapDepotToDto(depot);
  } catch (error) {
    if (error instanceof OperationsServiceError) throw error;
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      throw new OperationsServiceError(
        "Un depot portant ce code existe deja.",
        409,
      );
    }
    throw new OperationsServiceError("Impossible de creer le depot.", 500);
  }
}
