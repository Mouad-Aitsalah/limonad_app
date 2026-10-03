import type { UserRole } from "@/types/auth";

/**
 * Who may see the dashboard section "Intelligence & Prévisions IA" (sales
 * forecast, forecast revenue and purchase recommendations). Same roles as every
 * other forecasting entry point (lib/server/sales-forecast.ts,
 * purchase-recommendation.ts): admin and depot manager. The cashier - who can
 * open /dashboard - never gets purchase recommendations or global analyses.
 * Shared by the page (what is rendered) and by lib/server/dashboard-forecast.ts
 * (what is enforced).
 */
export const FORECAST_VIEW_ROLES: UserRole[] = ["admin", "depot_manager"];

export function canViewForecast(role: UserRole | null | undefined): boolean {
  return Boolean(role) && FORECAST_VIEW_ROLES.includes(role as UserRole);
}
