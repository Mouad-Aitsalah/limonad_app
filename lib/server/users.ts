import "server-only";

import { prisma } from "@/lib/prisma";
import type { User } from "@/types/user";
import type { UserRole } from "@/types/auth";

export async function getUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({
    orderBy: { fullName: "asc" },
  });

  return users.map((user) => ({
    id: user.id,
    nom: user.fullName,
    email: user.email,
    telephone: "",
    role: mapRole(user.role),
    actif: user.status === "ACTIVE",
    derniereConnexion: null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }));
}

function mapRole(role: string): UserRole {
  if (role === "ADMIN") return "admin";
  if (role === "DEPOT_MANAGER") return "depot_manager";
  if (role === "DRIVER") return "driver";
  return "cashier";
}

