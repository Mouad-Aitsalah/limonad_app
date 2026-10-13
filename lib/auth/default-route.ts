import { moduleForPagePath } from "@/lib/modules/registry";
import { isModuleEnabled } from "@/lib/modules/settings";
import type { UserRole } from "@/types/auth";

// When the usual landing page belongs to a module the SUPER_ADMIN disabled, the
// first of these that is still enabled (the catalogue is an essential module,
// so a staff user always lands somewhere).
const STAFF_FALLBACK_ROUTES = ["/dashboard", "/pos", "/ventes", "/ventes/journalieres", "/stock", "/produits"];

export function getDefaultRouteForRole(role: UserRole, disabledModules?: readonly string[]) {
  const preferred = preferredRoute(role);
  if (!disabledModules?.length || role === "super_admin") return preferred;

  const candidates =
    role === "driver"
      ? [preferred]
      : [preferred, ...STAFF_FALLBACK_ROUTES.filter((route) => !(role === "cashier" && route === "/dashboard"))];
  for (const route of candidates) {
    const moduleKey = moduleForPagePath(route);
    if (!moduleKey || isModuleEnabled(disabledModules, moduleKey)) return route;
  }
  return `/module-indisponible?module=${moduleForPagePath(preferred) ?? ""}`;
}

function preferredRoute(role: UserRole) {
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
