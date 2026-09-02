import "server-only";

import bcrypt from "bcryptjs";
import { z } from "zod";

import type {
  OrganizationDetailDto,
  OrganizationMutationInput,
  OrganizationSummaryDto,
  OrganizationUpdateInput,
} from "@/types/organization";
import { BCRYPT_COST } from "@/lib/password-hashing";
import { prisma } from "@/lib/prisma";
import { OperationsServiceError, provisionDepot } from "@/lib/server/depots";
import { requireSuperAdmin } from "@/lib/server/organization-context";
import { passwordPolicySchema } from "@/lib/server/password-policy";

const optionalNullableString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const organizationCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom de l'organisation est obligatoire."),
  code: z
    .string()
    .trim()
    .min(2, "Le code de l'organisation est obligatoire.")
    .max(32, "Le code de l'organisation est trop long."),
  tradeName: optionalNullableString,
  address: optionalNullableString,
  city: optionalNullableString,
  country: optionalNullableString,
  phone: optionalNullableString,
  email: z
    .string()
    .trim()
    .email("L'email de l'organisation est invalide.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  adminName: z.string().trim().min(1, "Le nom de l'admin principal est obligatoire."),
  adminEmail: z.string().trim().email("L'email admin est invalide."),
  adminPassword: passwordPolicySchema,
});

const organizationUpdateSchema = organizationCreateSchema.omit({
  adminName: true,
  adminEmail: true,
  adminPassword: true,
});

const organizationListInclude = {
  users: {
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  _count: {
    select: {
      users: true,
      products: true,
      customers: true,
      sales: true,
      purchases: true,
    },
  },
} as const;

type OrganizationRecord = Awaited<ReturnType<typeof getOrganizationRecordById>>;

export async function listOrganizations(): Promise<OrganizationSummaryDto[]> {
  await requireSuperAdmin();

  const organizations = await prisma.organization.findMany({
    include: organizationListInclude,
    orderBy: [{ createdAt: "desc" }, { name: "asc" }],
  });

  return organizations.map(mapOrganizationToSummaryDto);
}

export async function getOrganizationById(id: string): Promise<OrganizationDetailDto> {
  await requireSuperAdmin();

  const organization = await getOrganizationRecordById(id);
  if (!organization) {
    throw new OperationsServiceError("Organisation introuvable.", 404);
  }

  return {
    ...mapOrganizationToSummaryDto(organization),
    users: organization.users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    })),
  };
}

export async function createOrganization(
  input: OrganizationMutationInput,
): Promise<OrganizationDetailDto> {
  await requireSuperAdmin();

  const parsed = organizationCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs de l'organisation sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  const data = normalizeOrganizationCreateInput(parsed.data);
  const [organizationCodeOwner, organizationEmailOwner, adminEmailOwner] =
    await prisma.$transaction([
      prisma.organization.findUnique({
        where: { code: data.code },
        select: { id: true },
      }),
      data.email
        ? prisma.organization.findFirst({
            where: { email: data.email },
            select: { id: true },
          })
        : prisma.organization.findFirst({
            where: { id: "__never__" },
            select: { id: true },
          }),
      prisma.user.findUnique({
        where: { email: data.adminEmail },
        select: { id: true },
      }),
    ]);

  const fieldErrors: Record<string, string> = {};
  if (organizationCodeOwner) {
    fieldErrors.code = "Ce code organisation existe deja.";
  }
  if (organizationEmailOwner) {
    fieldErrors.email = "Cet email organisation existe deja.";
  }
  if (adminEmailOwner) {
    fieldErrors.adminEmail = "Cet email admin existe deja.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new OperationsServiceError(
      "Certains champs de l'organisation sont invalides.",
      409,
      fieldErrors,
    );
  }

  const adminPasswordHash = await bcrypt.hash(data.adminPassword, BCRYPT_COST);
  const organization = await prisma.$transaction(async (tx) => {
    const createdOrganization = await tx.organization.create({
      data: {
        code: data.code,
        name: data.name,
        tradeName: data.tradeName,
        address: data.address,
        city: data.city,
        country: data.country,
        phone: data.phone,
        email: data.email,
        status: data.status,
      },
      select: { id: true },
    });

    const adminName = splitName(data.adminName);
    const createdAdmin = await tx.user.create({
      data: {
        organizationId: createdOrganization.id,
        firstName: adminName.firstName,
        lastName: adminName.lastName,
        fullName: data.adminName,
        email: data.adminEmail,
        passwordHash: adminPasswordHash,
        role: "ADMIN",
        status: "ACTIVE",
      },
      select: { id: true },
    });

    // Every organization needs at least one depot + its DEPOT stock
    // location to be usable (POS, versements, stock). Provision a default
    // one here so a freshly created org is never stuck with an empty
    // /api/depots. The new admin is bound to it straight away.
    const defaultDepot = await provisionDepot(tx, {
      organizationId: createdOrganization.id,
      name: "Dépôt Principal",
      address: data.address,
      city: data.city,
    });
    await tx.user.update({
      where: { id: createdAdmin.id },
      data: { depotId: defaultDepot.id },
    });

    await tx.accountingSettings.create({
      data: {
        organizationId: createdOrganization.id,
        updatedByUserId: createdAdmin.id,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: createdAdmin.id,
        organizationId: createdOrganization.id,
        action: "CREATE_ORGANIZATION",
        entityType: "Organization",
        entityId: createdOrganization.id,
        newValue: {
          code: data.code,
          name: data.name,
          adminEmail: data.adminEmail,
        },
      },
    });

    return tx.organization.findUniqueOrThrow({
      where: { id: createdOrganization.id },
      include: organizationListInclude,
    });
  });

  return {
    ...mapOrganizationToSummaryDto(organization),
    users: organization.users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    })),
  };
}

export async function updateOrganization(
  id: string,
  input: OrganizationUpdateInput,
): Promise<OrganizationDetailDto> {
  await requireSuperAdmin();

  const parsed = organizationUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs de l'organisation sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  const data = normalizeOrganizationUpdateInput(parsed.data);
  const currentOrganization = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, code: true },
  });
  if (!currentOrganization) {
    throw new OperationsServiceError("Organisation introuvable.", 404);
  }

  const [organizationCodeOwner, organizationEmailOwner] = await prisma.$transaction([
    prisma.organization.findUnique({
      where: { code: data.code },
      select: { id: true },
    }),
    data.email
      ? prisma.organization.findFirst({
          where: { email: data.email, id: { not: id } },
          select: { id: true },
        })
      : prisma.organization.findFirst({
          where: { id: "__never__" },
          select: { id: true },
        }),
  ]);

  const fieldErrors: Record<string, string> = {};
  if (organizationCodeOwner && organizationCodeOwner.id !== id) {
    fieldErrors.code = "Ce code organisation existe deja.";
  }
  if (organizationEmailOwner) {
    fieldErrors.email = "Cet email organisation existe deja.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new OperationsServiceError(
      "Certains champs de l'organisation sont invalides.",
      409,
      fieldErrors,
    );
  }

  const organization = await prisma.organization.update({
    where: { id },
    data: {
      code: data.code,
      name: data.name,
      tradeName: data.tradeName,
      address: data.address,
      city: data.city,
      country: data.country,
      phone: data.phone,
      email: data.email,
      status: data.status,
    },
    include: organizationListInclude,
  });

  return {
    ...mapOrganizationToSummaryDto(organization),
    users: organization.users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    })),
  };
}

function mapOrganizationToSummaryDto(
  organization: NonNullable<OrganizationRecord>,
): OrganizationSummaryDto {
  const adminUsers = organization.users.filter((user) => user.role === "ADMIN");
  const admin = adminUsers[0] ?? null;

  return {
    id: organization.id,
    code: organization.code,
    name: organization.name,
    tradeName: organization.tradeName,
    address: organization.address,
    city: organization.city,
    country: organization.country,
    phone: organization.phone,
    email: organization.email,
    status: organization.status,
    admin: admin
      ? {
          id: admin.id,
          fullName: admin.fullName,
          email: admin.email,
          status: admin.status,
        }
      : null,
    stats: {
      usersCount: organization._count.users,
      adminsCount: adminUsers.length,
      cashiersCount: organization.users.filter((user) => user.role === "CASHIER").length,
      driversCount: organization.users.filter((user) => user.role === "DRIVER").length,
      productsCount: organization._count.products,
      customersCount: organization._count.customers,
      salesCount: organization._count.sales,
      purchasesCount: organization._count.purchases,
    },
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

async function getOrganizationRecordById(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    include: organizationListInclude,
  });
}

function normalizeOrganizationCode(value: string) {
  return value.trim().replace(/\s+/g, "-").toUpperCase();
}

function normalizeOrganizationCreateInput(
  data: z.infer<typeof organizationCreateSchema>,
) {
  return {
    ...data,
    name: data.name.trim(),
    code: normalizeOrganizationCode(data.code),
    tradeName: data.tradeName ?? null,
    address: data.address ?? null,
    city: data.city ?? null,
    country: data.country ?? null,
    phone: data.phone ?? null,
    email: data.email?.trim().toLowerCase() ?? null,
    status: data.status ?? "ACTIVE",
    adminName: data.adminName.trim(),
    adminEmail: data.adminEmail.trim().toLowerCase(),
  };
}

function normalizeOrganizationUpdateInput(
  data: z.infer<typeof organizationUpdateSchema>,
) {
  return {
    ...data,
    name: data.name.trim(),
    code: normalizeOrganizationCode(data.code),
    tradeName: data.tradeName ?? null,
    address: data.address ?? null,
    city: data.city ?? null,
    country: data.country ?? null,
    phone: data.phone ?? null,
    email: data.email?.trim().toLowerCase() ?? null,
    status: data.status ?? "ACTIVE",
  };
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? fullName,
    lastName: parts.slice(1).join(" ") || "-",
  };
}
