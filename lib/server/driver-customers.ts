import "server-only";

import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/server/auth";
import {
  ensureUniquePhone,
  mapCustomerToDto,
  nextCustomerCode,
  parseCustomerInput,
} from "@/lib/server/customers";
import { OperationsServiceError } from "@/lib/server/depots";
import type { CustomerDto, CustomerMutationInput } from "@/types/operations-dto";

const customerInclude = {
  createdBy: { select: { fullName: true } },
} as const;

export async function getCustomersForCurrentDriver(): Promise<CustomerDto[]> {
  const user = await requireSessionUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);

  const customers = await prisma.customer.findMany({
    where: {
      OR: [{ creationOrigin: "ADMIN" }, { createdByDriverId: user.driverId }],
    },
    include: customerInclude,
    orderBy: { name: "asc" },
  });
  return customers.map(mapCustomerToDto);
}

export async function createCustomerForCurrentDriver(
  input: CustomerMutationInput,
  customerId?: string,
): Promise<CustomerDto> {
  const user = await requireSessionUser(["driver"]);
  if (!user.driverId) throw new OperationsServiceError("Profil chauffeur introuvable.", 403);
  const data = await parseCustomerInput(input);
  await ensureUniquePhone(data.phone, customerId);

  const customer = await prisma.$transaction(
    async (tx) => {
      if (customerId) {
        const existing = await tx.customer.findUnique({
          where: { id: customerId },
          select: { id: true, createdByDriverId: true, status: true },
        });
        if (!existing) throw new OperationsServiceError("Client introuvable.", 404);
        if (existing.createdByDriverId !== user.driverId) {
          throw new OperationsServiceError("Vous ne pouvez modifier que vos clients.", 403);
        }

        return tx.customer.update({
          where: { id: customerId },
          data: {
            name: data.name,
            phone: data.phone,
            email: data.email,
            address: data.address,
            city: data.city,
            type: data.type,
            creditLimit: data.creditLimit ?? 0,
            ice: data.ice,
            taxId: data.taxId,
            contactName: data.contactName,
            latitude: data.latitude,
            longitude: data.longitude,
            notes: data.notes,
            status: existing.status === "BLOCKED" ? "BLOCKED" : (data.status ?? "ACTIVE"),
          },
          include: customerInclude,
        });
      }

      return tx.customer.create({
        data: {
          ...data,
          code: await nextCustomerCode(tx),
          status: "ACTIVE",
          creditLimit: data.creditLimit ?? 0,
          currentBalance: 0,
          createdByUserId: user.id,
          createdByDriverId: user.driverId,
          createdFromTruckId: user.truckId ?? null,
          creationOrigin: "DRIVER",
        },
        include: customerInclude,
      });
    },
    { isolationLevel: "Serializable" },
  );

  return mapCustomerToDto(customer);
}
