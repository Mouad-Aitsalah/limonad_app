import "server-only";

import bcrypt from "bcryptjs";
import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { UserRole } from "@/types/auth";
import type { CreatableUserRole, User, UserCreateInput } from "@/types/user";

const userInclude = {
  organization: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.UserInclude;

type UserRecord = Prisma.UserGetPayload<{ include: typeof userInclude }>;

// Only roles an organization admin is allowed to hand out - super_admin is
// never accepted here, at the schema level, regardless of what the client
// sends. It is provisioned through a separate super-admin surface.
const creatableRoleValues = ["admin", "depot_manager", "cashier", "driver"] as const satisfies readonly CreatableUserRole[];

const createUserSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est obligatoire.").max(160),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("L'adresse email est invalide."),
  telephone: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional(),
  password: z.string().min(6, "Le mot de passe doit contenir au moins 6 caracteres."),
  role: z.enum(creatableRoleValues),
  actif: z.boolean().optional(),
});

export async function getUsers(): Promise<User[]> {
  const currentUser = await requireOrganizationUser(["admin"]);
  const users = await prisma.user.findMany({
    where: { organizationId: currentUser.organizationId },
    orderBy: { fullName: "asc" },
    include: userInclude,
  });

  return users.map(mapUserToDto);
}

/**
 * Real creation flow: password hashed with bcrypt, organizationId taken
 * only from the admin's own session (never from the request body), email
 * uniqueness checked before insert, and a DRIVER role also gets its Driver
 * profile row created in the same transaction (COMDIS's driver-scoped
 * screens - /driver/*, tournees, chargements - all key off Driver, not
 * User, so a driver-role account without one would be unusable).
 */
export async function createUser(input: UserCreateInput): Promise<User> {
  const currentUser = await requireOrganizationUser(["admin"]);
  const data = validateCreateUserInput(input);

  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) {
    throw new OperationsServiceError("Cet email est deja utilise par un autre utilisateur.", 409, {
      email: "Cet email est deja utilise par un autre utilisateur.",
    });
  }

  const { firstName, lastName } = splitFullName(data.nom);
  const passwordHash = await bcrypt.hash(data.password, 10);
  const dbRole = toDbRole(data.role);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: currentUser.organizationId,
          firstName,
          lastName,
          fullName: data.nom,
          email: data.email,
          phone: data.telephone,
          passwordHash,
          role: dbRole,
          status: (data.actif ?? true) ? "ACTIVE" : "INACTIVE",
        },
      });

      if (dbRole === "DRIVER") {
        const employeeCode = await nextDriverEmployeeCode(tx, currentUser.organizationId);
        await tx.driver.create({
          data: {
            organizationId: currentUser.organizationId,
            employeeCode,
            userId: created.id,
            phone: data.telephone,
            active: (data.actif ?? true),
          },
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        include: userInclude,
      });
    });

    return mapUserToDto(user);
  } catch (error) {
    throw mapUserError(error);
  }
}

function validateCreateUserInput(input: UserCreateInput) {
  const parsed = createUserSchema.safeParse(input);
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

async function nextDriverEmployeeCode(tx: Prisma.TransactionClient, organizationId: string) {
  const drivers = await tx.driver.findMany({
    where: { organizationId, employeeCode: { startsWith: "DRV-" } },
    select: { employeeCode: true },
  });
  const highest = drivers.reduce((max, driver) => {
    const match = driver.employeeCode.match(/^DRV-(\d+)$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);
  return `DRV-${String(highest + 1).padStart(4, "0")}`;
}

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? fullName;
  const lastName = parts.slice(1).join(" ") || firstName;
  return { firstName, lastName };
}

function toDbRole(role: CreatableUserRole) {
  if (role === "admin") return "ADMIN";
  if (role === "depot_manager") return "DEPOT_MANAGER";
  if (role === "driver") return "DRIVER";
  return "CASHIER";
}

function mapRole(role: string): UserRole {
  if (role === "SUPER_ADMIN") return "super_admin";
  if (role === "ADMIN") return "admin";
  if (role === "DEPOT_MANAGER") return "depot_manager";
  if (role === "DRIVER") return "driver";
  return "cashier";
}

function mapUserToDto(user: UserRecord): User {
  return {
    id: user.id,
    nom: user.fullName,
    email: user.email,
    telephone: user.phone ?? "",
    role: mapRole(user.role),
    actif: user.status === "ACTIVE",
    organizationId: user.organizationId,
    organizationName: user.organization?.name ?? null,
    derniereConnexion: null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function mapUserError(error: unknown) {
  if (error instanceof OperationsServiceError) return error;
  const prismaError = error as { code?: string };
  if (prismaError.code === "P2002") {
    return new OperationsServiceError("Cet email est deja utilise par un autre utilisateur.", 409, {
      email: "Cet email est deja utilise par un autre utilisateur.",
    });
  }
  return new OperationsServiceError("Une erreur est survenue.", 500);
}
