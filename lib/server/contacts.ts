import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { UserRole } from "@/types/auth";
import type {
  ContactDto,
  ContactInput,
  ContactsPayload,
  ContactStatus,
} from "@/types/contacts";

// COMDIS has no "super_admin" role - this maps the spec's "ADMIN / SUPER_ADMIN"
// onto the real role enum (admin/depot_manager/cashier/driver).
const contactManagerRoles: UserRole[] = ["admin"];

const contactInclude = {
  supplier: { select: { code: true, name: true } },
} as const;

type ContactRecord = {
  id: string;
  reference: string;
  fullName: string;
  supplierId: string | null;
  supplier: { code: string; name: string } | null;
  phone1: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: ContactStatus;
  createdAt: Date;
  updatedAt: Date;
};

const optionalString = () =>
  z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();

const contactInputSchema = z.object({
  reference: z.string().trim().min(1, "La reference est obligatoire.").max(60),
  fullName: z.string().trim().min(1, "Le nom complet est obligatoire.").max(160),
  // Phone numbers are always free-form text (never coerced to a number), so
  // a leading 0, +212, spaces or any international format survive as typed.
  phone1: optionalString(),
  phone2: optionalString(),
  supplierId: optionalString(),
  email: z
    .string()
    .trim()
    .email("L'adresse email est invalide.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  address: optionalString(),
  notes: optionalString(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function getContacts(): Promise<ContactsPayload> {
  const currentUser = await requireOrganizationUser(contactManagerRoles);

  const contacts = await prisma.contact.findMany({
    where: { organizationId: currentUser.organizationId },
    include: contactInclude,
    orderBy: [{ createdAt: "desc" }, { reference: "asc" }],
  });

  const items = contacts.map(mapContactToDto);

  return {
    items,
    summary: {
      totalCount: items.length,
      activeCount: items.filter((contact) => contact.status === "ACTIVE").length,
      linkedToSupplierCount: items.filter((contact) => contact.supplierId !== null).length,
      withoutPhoneCount: items.filter((contact) => !contact.phone1 && !contact.phone2).length,
    },
  };
}

export async function getContactById(id: string): Promise<ContactDto> {
  const currentUser = await requireOrganizationUser(contactManagerRoles);

  const contact = await prisma.contact.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    include: contactInclude,
  });
  if (!contact) {
    throw new OperationsServiceError("Contact introuvable.", 404);
  }
  return mapContactToDto(contact);
}

export async function createContact(input: ContactInput): Promise<ContactDto> {
  const currentUser = await requireOrganizationUser(contactManagerRoles);
  const data = validateContactInput(input);

  if (data.supplierId) {
    await assertSupplierExists(currentUser.organizationId, data.supplierId);
  }

  try {
    const contact = await prisma.contact.create({
      data: {
        organization: {
          connect: { id: currentUser.organizationId },
        },
        reference: data.reference,
        fullName: data.fullName,
        supplier: data.supplierId
          ? {
              connect: { id: data.supplierId },
            }
          : undefined,
        phone1: data.phone1,
        phone2: data.phone2,
        email: data.email,
        address: data.address,
        notes: data.notes,
        status: data.status ?? "ACTIVE",
      },
      include: contactInclude,
    });
    return mapContactToDto(contact);
  } catch (error) {
    throw mapContactError(error);
  }
}

/**
 * The reference is editable (item 7 of the spec): it is not used as a
 * foreign key anywhere in COMDIS, only as a unique display identifier, so
 * changing it is safe - the unique constraint (re-checked here as a clear
 * 409 instead of a raw Prisma error) is the only real constraint.
 */
export async function updateContact(id: string, input: ContactInput): Promise<ContactDto> {
  const currentUser = await requireOrganizationUser(contactManagerRoles);
  const data = validateContactInput(input);

  const existing = await prisma.contact.findFirst({
    where: { id, organizationId: currentUser.organizationId },
    select: { id: true },
  });
  if (!existing) {
    throw new OperationsServiceError("Contact introuvable.", 404);
  }

  if (data.supplierId) {
    await assertSupplierExists(currentUser.organizationId, data.supplierId);
  }

  try {
    const contact = await prisma.contact.update({
      where: { id },
      data: {
        reference: data.reference,
        fullName: data.fullName,
        supplier: data.supplierId
          ? {
              connect: { id: data.supplierId },
            }
          : { disconnect: true },
        phone1: data.phone1,
        phone2: data.phone2,
        email: data.email,
        address: data.address,
        notes: data.notes,
        status: data.status ?? "ACTIVE",
      },
      include: contactInclude,
    });
    return mapContactToDto(contact);
  } catch (error) {
    throw mapContactError(error);
  }
}

function validateContactInput(input: ContactInput) {
  const parsed = contactInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }
  return parsed.data;
}

async function assertSupplierExists(organizationId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, organizationId },
    select: { id: true },
  });
  if (!supplier) {
    throw new OperationsServiceError("Fournisseur introuvable.", 422, {
      supplierId: "Fournisseur introuvable.",
    });
  }
}

function mapContactToDto(contact: ContactRecord): ContactDto {
  return {
    id: contact.id,
    reference: contact.reference,
    fullName: contact.fullName,
    supplierId: contact.supplierId,
    supplierCode: contact.supplier?.code ?? null,
    supplierName: contact.supplier?.name ?? null,
    phone1: contact.phone1,
    phone2: contact.phone2,
    email: contact.email,
    address: contact.address,
    notes: contact.notes,
    status: contact.status,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

export function mapContactError(error: unknown) {
  if (error instanceof OperationsServiceError) return error;
  const prismaError = error as { code?: string; meta?: { target?: string[] } };
  if (prismaError.code === "P2002") {
    return new OperationsServiceError("Cette reference existe deja.", 409, {
      reference: "Cette reference existe deja.",
    });
  }
  if (prismaError.code === "P2025") {
    return new OperationsServiceError("Contact introuvable.", 404);
  }
  return new OperationsServiceError("Une erreur est survenue.", 500);
}
