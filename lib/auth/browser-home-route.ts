import { getDefaultRouteForRole } from "@/lib/auth/default-route";
import type { UserRole } from "@/types/auth";

export const MOBILE_HOME_ROUTE = "/mobile";
// Tailwind's unchanged lg breakpoint. CSS controls layout; this query is
// only used when choosing the initial navigation destination.
export const DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";

export function getBrowserHomeRoute(role: UserRole) {
  return typeof window !== "undefined" && !window.matchMedia(DESKTOP_MEDIA_QUERY).matches
    ? MOBILE_HOME_ROUTE
    : getDefaultRouteForRole(role);
}
