import type { UserRole } from "@/types/auth";

export function getDefaultRouteForRole(role: UserRole) {
  switch (role) {
    case "super_admin":
      return "/organisations";
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
