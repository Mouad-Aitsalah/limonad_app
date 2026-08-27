import "server-only";

import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { User } from "@/types/user";
import type { UserRole } from "@/types/auth";

export async function getUsers(): Promise<User[]> {
  const currentUser = await requireOrganizationUser(["admin"]);
  const users = await prisma.user.findMany({
    where: { organizationId: currentUser.organizationId },
    orderBy: { fullName: "asc" },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return users.map((user) => ({
    id: user.id,
    nom: user.fullName,
    email: user.email,
    telephone: "",
    role: mapRole(user.role),
    actif: user.status === "ACTIVE",
    organizationId: user.organizationId,
    organizationName: user.organization?.name ?? null,
    derniereConnexion: null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }));
}

function mapRole(role: string): UserRole {
  if (role === "SUPER_ADMIN") return "super_admin";
  if (role === "ADMIN") return "admin";
  if (role === "DEPOT_MANAGER") return "depot_manager";
  if (role === "DRIVER") return "driver";
  return "cashier";
}
