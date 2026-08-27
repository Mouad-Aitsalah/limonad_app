import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { TruckDto, TruckMutationInput } from "@/types/operations-dto";

export const truckInclude = {
  depot: { select: { id: true, code: true, name: true } },
  defaultDriver: {
    select: {
      id: true,
      user: { select: { fullName: true } },
    },
  },
  assignedDriver: {
    select: {
      id: true,
      user: { select: { fullName: true } },
    },
  },
  stockLocation: { select: { id: true, code: true, name: true } },
};

export const truckMutationSchema = z.object({
  code: z.string().trim().min(1, "Le code est obligatoire."),
  registration: z.string().trim().min(1, "L'immatriculation est obligatoire."),
  brand: z.string().trim().nullable().optional(),
  model: z.string().trim().nullable().optional(),
  capacity: z.coerce
    .number()
    .positive("La capacite doit etre positive.")
    .nullable()
    .optional(),
  status: z.enum(["AVAILABLE", "LOADING", "ON_TOUR", "MAINTENANCE", "INACTIVE"]),
  depotId: z.string().trim().min(1, "Le depot est obligatoire."),
});

type TruckRecord = Awaited<ReturnType<typeof getTruckRecordById>>;

export function mapTruckToDto(truck: NonNullable<TruckRecord>): TruckDto {
  return {
    id: truck.id,
    code: truck.code,
    registration: truck.registration,
    brand: truck.brand,
    model: truck.model,
    capacity: truck.capacity,
    status: truck.status,
    active: truck.status !== "INACTIVE",
    depot: truck.depot,
    defaultDriver: truck.defaultDriver
      ? {
          id: truck.defaultDriver.id,
          name: truck.defaultDriver.user.fullName,
        }
      : null,
    assignedDriver: truck.assignedDriver
      ? {
          id: truck.assignedDriver.id,
          name: truck.assignedDriver.user.fullName,
        }
      : null,
    stockLocation: truck.stockLocation,
    createdAt: truck.createdAt.toISOString(),
    updatedAt: truck.updatedAt.toISOString(),
  };
}

export async function getTrucks(): Promise<TruckDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const trucks = await prisma.truck.findMany({
    where: { organizationId: currentUser.organizationId },
    include: truckInclude,
    orderBy: { code: "asc" },
  });
  return hydrateTruckStockSummaries(
    currentUser.organizationId,
    trucks.map(mapTruckToDto),
  );
}

export async function getTruckById(id: string): Promise<TruckDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const truck = await getTruckRecordById(id, currentUser.organizationId);
  if (!truck) throw new OperationsServiceError("Camion introuvable.", 404);
  const [hydrated] = await hydrateTruckStockSummaries(
    currentUser.organizationId,
    [mapTruckToDto(truck)],
  );
  return hydrated;
}

export async function createTruck(input: TruckMutationInput): Promise<TruckDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const data = await validateTruckInput(currentUser.organizationId, input);

  try {
    const truck = await prisma.$transaction(async (tx) => {
      const createdTruck = await tx.truck.create({
        data: {
          ...data,
          organizationId: currentUser.organizationId,
        },
        include: truckInclude,
      });

      await tx.stockLocation.create({
        data: {
          organizationId: currentUser.organizationId,
          code: createdTruck.code,
          name: `Stock ${createdTruck.code}`,
          type: "TRUCK",
          truckId: createdTruck.id,
          active: createdTruck.status !== "INACTIVE",
        },
      });

      return tx.truck.findUniqueOrThrow({
        where: { id: createdTruck.id },
        include: truckInclude,
      });
    });

    return mapTruckToDto(truck);
  } catch (error) {
    throw mapTruckError(error);
  }
}

export async function updateTruck(
  id: string,
  input: TruckMutationInput,
): Promise<TruckDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getTruckRecordById(id, currentUser.organizationId);
  if (!existing) {
    throw new OperationsServiceError("Camion introuvable.", 404);
  }
  const data = await validateTruckInput(currentUser.organizationId, input, id);

  try {
    const truck = await prisma.truck.update({
      where: { id },
      data,
      include: truckInclude,
    });

    await prisma.stockLocation.updateMany({
      where: { truckId: id, organizationId: currentUser.organizationId },
      data: {
        code: truck.code,
        name: `Stock ${truck.code}`,
        active: truck.status !== "INACTIVE",
      },
    });

    return mapTruckToDto(truck);
  } catch (error) {
    throw mapTruckError(error);
  }
}

export async function setTruckStatus(
  id: string,
  active: boolean,
): Promise<TruckDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getTruckRecordById(id, currentUser.organizationId);
  if (!existing) {
    throw new OperationsServiceError("Camion introuvable.", 404);
  }

  try {
    const truck = await prisma.truck.update({
      where: { id },
      data: { status: active ? "AVAILABLE" : "INACTIVE" },
      include: truckInclude,
    });
    await prisma.stockLocation.updateMany({
      where: { truckId: id, organizationId: currentUser.organizationId },
      data: { active },
    });
    const [hydrated] = await hydrateTruckStockSummaries(
      currentUser.organizationId,
      [mapTruckToDto(truck)],
    );
    return hydrated;
  } catch (error) {
    throw mapTruckError(error);
  }
}

async function getTruckRecordById(id: string, organizationId: string) {
  return prisma.truck.findFirst({
    where: { id, organizationId },
    include: truckInclude,
  });
}

async function validateTruckInput(
  organizationId: string,
  input: TruckMutationInput,
  currentTruckId?: string,
) {
  const parsed = truckMutationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  const data = {
    ...parsed.data,
    brand: parsed.data.brand || null,
    model: parsed.data.model || null,
    capacity: parsed.data.capacity ?? null,
  };

  const [codeOwner, registrationOwner, depot] = await prisma.$transaction([
    prisma.truck.findFirst({
      where: { code: data.code, organizationId },
      select: { id: true },
    }),
    prisma.truck.findFirst({
      where: { registration: data.registration, organizationId },
      select: { id: true },
    }),
    prisma.depot.findFirst({
      where: { id: data.depotId, organizationId },
      select: { id: true },
    }),
  ]);

  const fieldErrors: Record<string, string> = {};
  if (codeOwner && codeOwner.id !== currentTruckId) {
    fieldErrors.code = "Ce code camion existe deja.";
  }
  if (registrationOwner && registrationOwner.id !== currentTruckId) {
    fieldErrors.registration = "Cette immatriculation existe deja.";
  }
  if (!depot) {
    fieldErrors.depotId = "Depot inexistant.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new OperationsServiceError("Certains champs sont invalides.", 422, fieldErrors);
  }

  return data;
}

async function hydrateTruckStockSummaries(
  organizationId: string,
  trucks: TruckDto[],
) {
  const stockLocationIds = trucks
    .map((truck) => truck.stockLocation?.id)
    .filter((id): id is string => Boolean(id));

  if (stockLocationIds.length === 0) {
    return trucks.map((truck) => ({ ...truck, stockSummary: { totalQuantity: 0, productCount: 0 } }));
  }

  const levels = await prisma.stockLevel.findMany({
    where: {
      organizationId,
      locationId: { in: stockLocationIds },
      quantity: { gt: 0 },
    },
    select: { locationId: true, quantity: true, productId: true },
  });

  const summaries = new Map<
    string,
    {
      totalQuantity: number;
      productIds: Set<string>;
    }
  >();

  for (const level of levels) {
    const current = summaries.get(level.locationId) ?? {
      totalQuantity: 0,
      productIds: new Set<string>(),
    };
    current.totalQuantity += level.quantity;
    current.productIds.add(level.productId);
    summaries.set(level.locationId, current);
  }

  return trucks.map((truck) => {
    const summary = truck.stockLocation ? summaries.get(truck.stockLocation.id) : null;

    return {
      ...truck,
      stockSummary: {
        totalQuantity: summary?.totalQuantity ?? 0,
        productCount: summary?.productIds.size ?? 0,
      },
    };
  });
}

function mapTruckError(error: unknown) {
  const prismaError = error as { code?: string; meta?: { target?: string[] } };
  if (prismaError.code === "P2025") {
    return new OperationsServiceError("Camion introuvable.", 404);
  }
  if (prismaError.code === "P2002") {
    const target = prismaError.meta?.target ?? [];
    if (target.includes("code")) {
      return new OperationsServiceError("Ce code camion existe deja.", 409, {
        code: "Ce code camion existe deja.",
      });
    }
    if (target.includes("registration")) {
      return new OperationsServiceError("Cette immatriculation existe deja.", 409, {
        registration: "Cette immatriculation existe deja.",
      });
    }
  }
  return new OperationsServiceError("Une erreur est survenue.", 500);
}
