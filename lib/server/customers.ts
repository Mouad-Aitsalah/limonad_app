import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { CustomerDto, CustomerMutationInput } from "@/types/operations-dto";

const customerTypes = [
  "GROCERY",
  "CAFE",
  "RESTAURANT",
  "SUPERMARKET",
  "WHOLESALER",
  "COUNTER",
  "OTHER",
] as const;

const customerStatuses = ["ACTIVE", "INACTIVE", "BLOCKED"] as const;
const customerAccountPrefix = "3421";

export const customerMutationSchema = z.object({
  code: optionalString(),
  name: z.string().trim().min(1, "Le nom est obligatoire."),
  phone: z.string().trim().min(1, "Le telephone est obligatoire."),
  email: z
    .string()
    .trim()
    .email("L'adresse email est invalide.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  address: z.string().trim().min(1, "L'adresse est obligatoire."),
  city: z.string().trim().min(1, "La ville est obligatoire."),
  type: z.enum(customerTypes, { error: "Le type est obligatoire." }),
  status: z.enum(customerStatuses).optional(),
  creditLimit: z.coerce
    .number()
    .min(0, "Le plafond de credit ne peut pas etre negatif.")
    .optional(),
  ice: optionalString(),
  taxId: optionalString(),
  contactName: optionalString(),
  latitude: z.coerce.number().nullable().optional(),
  longitude: z.coerce.number().nullable().optional(),
  notes: optionalString(),
});

type CustomerRecord = Awaited<ReturnType<typeof getCustomerRecordById>>;

export function mapCustomerToDto(customer: NonNullable<CustomerRecord>): CustomerDto {
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    city: customer.city,
    type: customer.type,
    status: customer.status,
    creditLimit: customer.creditLimit.toNumber(),
    currentBalance: customer.currentBalance.toNumber(),
    ice: customer.ice,
    taxId: customer.taxId,
    contactName: customer.contactName,
    latitude: customer.latitude?.toNumber() ?? null,
    longitude: customer.longitude?.toNumber() ?? null,
    notes: customer.notes,
    createdByUserId: customer.createdByUserId,
    createdByUserName: customer.createdBy.fullName,
    createdByDriverId: customer.createdByDriverId,
    createdFromTruckId: customer.createdFromTruckId,
    creationOrigin: customer.creationOrigin,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

export async function getCustomers(): Promise<CustomerDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const customers = await prisma.customer.findMany({
    where: { organizationId: currentUser.organizationId },
    include: customerInclude,
    orderBy: { name: "asc" },
  });
  return customers.map(mapCustomerToDto);
}

export async function getCustomerById(id: string): Promise<CustomerDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const customer = await getCustomerRecordById(id, currentUser.organizationId);
  if (!customer) throw new OperationsServiceError("Client introuvable.", 404);
  return mapCustomerToDto(customer);
}

export async function createCustomer(input: CustomerMutationInput): Promise<CustomerDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const data = await parseCustomerInput(input);
  const { code, ...customerData } = data;
  await ensureUniquePhone(user.organizationId, data.phone);
  await ensureUniqueCustomerCode(user.organizationId, data.code);

  const customer = await prisma.$transaction(
    async (tx) => {
      return tx.customer.create({
        data: {
          organizationId: user.organizationId,
          ...customerData,
          code: code ?? (await nextCustomerCode(tx, user.organizationId)),
          status: customerData.status ?? "ACTIVE",
          creditLimit: customerData.creditLimit ?? 0,
          currentBalance: 0,
          createdByUserId: user.id,
          creationOrigin: "ADMIN",
        },
        include: customerInclude,
      });
    },
    { isolationLevel: "Serializable" },
  );
  return mapCustomerToDto(customer);
}

export async function updateCustomer(
  id: string,
  input: CustomerMutationInput,
): Promise<CustomerDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getCustomerRecordById(id, currentUser.organizationId);
  if (!existing) {
    throw new OperationsServiceError("Client introuvable.", 404);
  }
  const data = await parseCustomerInput(input);
  const { code, ...customerData } = data;
  await ensureUniquePhone(currentUser.organizationId, data.phone, id);
  await ensureUniqueCustomerCode(currentUser.organizationId, data.code, id);

  const customer = await prisma.customer.update({
    where: { id },
    data: {
      ...customerData,
      ...(code ? { code } : {}),
      creditLimit: customerData.creditLimit ?? 0,
      status: customerData.status ?? "ACTIVE",
    },
    include: customerInclude,
  });
  return mapCustomerToDto(customer);
}

export async function setCustomerStatus(
  id: string,
  status: string,
): Promise<CustomerDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager"]);
  if (!customerStatuses.includes(status as (typeof customerStatuses)[number])) {
    throw new OperationsServiceError("Statut invalide.", 422);
  }
  const existing = await getCustomerRecordById(id, currentUser.organizationId);
  if (!existing) {
    throw new OperationsServiceError("Client introuvable.", 404);
  }
  const customer = await prisma.customer.update({
    where: { id },
    data: { status: status as (typeof customerStatuses)[number] },
    include: customerInclude,
  });
  return mapCustomerToDto(customer);
}

export async function parseCustomerInput(input: CustomerMutationInput) {
  const parsed = customerMutationSchema.safeParse(input);
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
  return parsed.data;
}

export async function ensureUniqueCustomerCode(
  organizationId: string,
  code?: string | null,
  currentCustomerId?: string,
) {
  if (!code) return;
  const owner = await prisma.customer.findFirst({
    where: {
      code,
      organizationId,
      ...(currentCustomerId ? { id: { not: currentCustomerId } } : {}),
    },
    select: { id: true },
  });
  if (owner) {
    throw new OperationsServiceError("Un client existe deja avec ce code.", 409, {
      code: "Un client existe deja avec ce code.",
    });
  }
}

export async function ensureUniquePhone(
  organizationId: string,
  phone: string,
  currentCustomerId?: string,
) {
  const owner = await prisma.customer.findFirst({
    where: {
      phone,
      organizationId,
      ...(currentCustomerId ? { id: { not: currentCustomerId } } : {}),
    },
    select: { id: true },
  });
  if (owner) {
    throw new OperationsServiceError("Un client existe deja avec ce telephone.", 409, {
      phone: "Un client existe deja avec ce telephone.",
    });
  }
}

export async function nextCustomerCode(
  tx: Pick<typeof prisma, "customer">,
  organizationId: string,
) {
  const customers = await tx.customer.findMany({
    where: {
      organizationId,
      code: { startsWith: customerAccountPrefix },
    },
    select: { code: true },
  });

  const highest = customers.reduce((max, customer) => {
    const match = customer.code.match(/^3421(\d+)$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `${customerAccountPrefix}${highest + 1}`;
}

function optionalString() {
  return z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();
}

const customerInclude = {
  createdBy: { select: { fullName: true } },
} as const;

async function getCustomerRecordById(id: string, organizationId: string) {
  return prisma.customer.findFirst({
    where: { id, organizationId },
    include: customerInclude,
  });
}
