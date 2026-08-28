import type { UserRole } from "@/types/auth";

export type User = {
  id: string;
  nom: string;
  email: string;
  telephone: string;
  role: UserRole;
  actif: boolean;
  organizationId: string | null;
  organizationName: string | null;
  derniereConnexion: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Only populated when role === "driver" - mirrors the Driver row created
  // alongside a DRIVER-role User (lib/server/users.ts#createUser). null for
  // every other role, and null truck simply means "not assigned yet".
  driver: {
    id: string;
    truck: { id: string; code: string; registration: string } | null;
  } | null;
};

// The org-admin-only "Nouvel utilisateur" role choices - never includes
// super_admin, which is provisioned through a separate super-admin surface.
export type CreatableUserRole = Exclude<UserRole, "super_admin">;

export type UserCreateInput = {
  nom: string;
  email: string;
  telephone?: string | null;
  password: string;
  role: CreatableUserRole;
  actif?: boolean;
};
