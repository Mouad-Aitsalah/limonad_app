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
};
