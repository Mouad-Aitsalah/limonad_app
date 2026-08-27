import type { UserRole } from "@/types/auth";

export function getDefaultRouteForRole(role: UserRole) {
  switch (role) {
    case "driver":
      return "/driver";
    case "cashier":
      return "/pos";
    case "admin":
    case "depot_manager":
    default:
      return "/dashboard";
  }
}
