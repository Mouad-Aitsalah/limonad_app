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
  // Depot the user operates from. Required in practice for the roles that
  // use depot-scoped screens (POS, versements) - see lib/server/users.ts.
  // null for a user not yet assigned, and for driver-role users (they are
  // scoped through Truck/Driver, not Depot).
  depotId: string | null;
  depotName: string | null;
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
  /** Depot to assign. Validated server-side (exists, active, same org).
   * Ignored for driver-role users. */
  depotId?: string | null;
};

export type UserUpdateInput = {
  /** Only field currently editable through PATCH /api/users/[id]:
   * (re)assign or clear the user's operating depot. */
  depotId: string | null;
};
