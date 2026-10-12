import type { UserRole } from "@/types/auth";

/**
 * Who sees the Dashboard's « Créances clients » section and its data: the
 * administrator only. Shared by the page (what is rendered) and by
 * lib/server/receivables.ts (what is enforced - the API refuses every other
 * role whatever the page shows).
 */
export const RECEIVABLES_VIEW_ROLES: UserRole[] = ["admin"];

export function canViewReceivables(role: UserRole | null | undefined): boolean {
  return Boolean(role) && RECEIVABLES_VIEW_ROLES.includes(role as UserRole);
}
