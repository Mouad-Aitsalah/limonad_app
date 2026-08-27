import type { UserRole } from "@/types/auth";

export const roleLabels: Record<UserRole, string> = {
  admin: "Administrateur",
  depot_manager: "Responsable depot",
  cashier: "Caissier principal",
  driver: "Chauffeur",
};

export const roleOptions: { value: UserRole; label: string }[] = [
  { value: "admin", label: roleLabels.admin },
  { value: "depot_manager", label: roleLabels.depot_manager },
  { value: "cashier", label: roleLabels.cashier },
  { value: "driver", label: roleLabels.driver },
];
