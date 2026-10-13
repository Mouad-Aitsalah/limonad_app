export type UserRole =
  | "super_admin"
  | "admin"
  | "depot_manager"
  | "cashier"
  | "driver";

export type CurrentUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  nom: string;
  email: string;
  role: UserRole;
  organizationId: string | null;
  driverId?: string;
  truckId?: string;
  /**
   * Modules the SUPER_ADMIN disabled for this user's organisation (module keys
   * of lib/modules/registry.ts). Absent = every module enabled. Used to hide
   * menu entries; the server enforces the same list on pages and API routes.
   */
  disabledModules?: string[];
};
