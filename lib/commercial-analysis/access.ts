import type { UserRole } from "@/types/auth";

/**
 * Who may see the Dashboard's commercial analysis (« Analyse des ventes » and
 * « Couverture commerciale »): the administrator only. Shared by the page (what
 * is rendered) and by lib/server/commercial-analysis.ts (what is enforced - the
 * API refuses every other role whatever the page shows).
 */
export const COMMERCIAL_ANALYSIS_VIEW_ROLES: UserRole[] = ["admin"];

export function canViewCommercialAnalysis(role: UserRole | null | undefined): boolean {
  return Boolean(role) && COMMERCIAL_ANALYSIS_VIEW_ROLES.includes(role as UserRole);
}
