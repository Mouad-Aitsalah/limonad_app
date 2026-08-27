export type UserRole = "admin" | "depot_manager" | "cashier" | "driver";

export type CurrentUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  nom: string;
  email: string;
  role: UserRole;
  driverId?: string;
  truckId?: string;
};
