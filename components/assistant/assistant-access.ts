import type { UserRole } from "@/types/auth";

/**
 * Who may use the AI Assistant: the same single role as the /assistant-ia page,
 * its menu entry (components/layout/nav-items.ts) and the POST /api/ai/chat
 * route (requireOrganizationUser(["admin"])). Only used to decide whether the
 * header button is shown - the route still refuses any other role on its own.
 */
export const ASSISTANT_ROLES: UserRole[] = ["admin"];

export function canUseAssistant(role: UserRole | null | undefined): boolean {
  return Boolean(role) && ASSISTANT_ROLES.includes(role as UserRole);
}

/** The full assistant page: the header button and panel are not offered there. */
export const ASSISTANT_PAGE_PATH = "/assistant-ia";
