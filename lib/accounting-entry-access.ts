import type { UserRole } from "@/types/auth";

/**
 * Who may do what on "Comptabilité → Écriture comptable" (manual entries).
 * Single source of truth shared by the page / form (what is shown) and by
 * lib/server/accounting.ts (what is actually enforced) - the server never
 * trusts the UI.
 *
 *  - ADMIN / SUPER_ADMIN: everything (create, archive as draft, edit / delete /
 *    validate drafts, correct a posted entry from the Journal).
 *  - CAISSE (cashier): enter an entry and validate it from the form
 *    ("Valider l'écriture" = POSTED, with the usual balance check). Nothing
 *    else: no draft archive, no draft list / edit / delete / validate, no
 *    correction (contre-passation) of a posted entry.
 *  - every other role: no access.
 */
export const MANUAL_ENTRY_ADMIN_ROLES: UserRole[] = ["admin", "super_admin"];

/** Roles allowed to create (and validate from the form) a manual entry. */
export const MANUAL_ENTRY_CREATE_ROLES: UserRole[] = [...MANUAL_ENTRY_ADMIN_ROLES, "cashier"];

export type ManualEntryAccess = {
  /** Sees the entry form (the page itself is reachable by more roles). */
  canEnter: boolean;
  /** "Archiver" (DRAFT), the numbered draft navigation, edit / delete / validate a draft. */
  canManageDrafts: boolean;
  /** Correct (contre-passer) a posted manual entry, reached from the Journal. */
  canRevise: boolean;
};

export function getManualEntryAccess(role: UserRole | null | undefined): ManualEntryAccess {
  if (!role) return { canEnter: false, canManageDrafts: false, canRevise: false };
  const isAdmin = MANUAL_ENTRY_ADMIN_ROLES.includes(role);
  return {
    canEnter: MANUAL_ENTRY_CREATE_ROLES.includes(role),
    canManageDrafts: isAdmin,
    canRevise: isAdmin,
  };
}

/** True when `role` may create a manual entry with this status ("DRAFT" = archive). */
export function canCreateManualEntryWithStatus(
  role: UserRole | null | undefined,
  status: string | undefined,
): boolean {
  const access = getManualEntryAccess(role);
  return (status ?? "POSTED") === "DRAFT" ? access.canManageDrafts : access.canEnter;
}
