import "server-only";

import { prisma } from "@/lib/prisma";
import type { TableColumnPreference, TableColumnPreferences } from "@/lib/table-columns/columns";
import {
  readUserTablePreferences,
  resetUserTablePreference,
  saveUserTablePreference,
} from "@/lib/table-columns/preferences-core";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";

/**
 * Per-user column preferences ("Personnaliser les colonnes", lib/table-columns).
 * Only an ADMIN can customise (403 otherwise, whatever the UI shows), and every
 * read and write is scoped to the caller's OWN user id AND organisation, taken
 * from the session - never from the request (lib/table-columns/preferences-core.ts
 * filters on both). Display only: no business data is touched.
 */

/** Dashboard layout: the signed-in admin's preferences ({} for every other role / no session). */
export async function getTablePreferencesForShell(): Promise<TableColumnPreferences> {
  try {
    const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
    if (user.role !== "admin") return {};
    return await readUserTablePreferences(prisma, { userId: user.id, organizationId: user.organizationId });
  } catch {
    // No session / table not migrated yet: every table keeps its default columns.
    return {};
  }
}

export async function getMyTablePreferences(): Promise<TableColumnPreferences> {
  const user = await requireOrganizationUser(["admin"]);
  return readUserTablePreferences(prisma, { userId: user.id, organizationId: user.organizationId });
}

/** Body: { table, order: [keys], hidden: [keys] }. */
export async function saveMyTablePreference(
  input: unknown,
): Promise<{ table: string; preference: TableColumnPreference }> {
  const user = await requireOrganizationUser(["admin"]);
  const result = await saveUserTablePreference(
    prisma,
    { userId: user.id, organizationId: user.organizationId },
    input,
  );
  if (!result.ok) throw new OperationsServiceError(result.message, 422, { table: result.message });
  return { table: result.table, preference: result.preference };
}

/** "Restaurer les colonnes par défaut" for one table. */
export async function resetMyTablePreference(table: unknown): Promise<{ table: string }> {
  const user = await requireOrganizationUser(["admin"]);
  const result = await resetUserTablePreference(
    prisma,
    { userId: user.id, organizationId: user.organizationId },
    table,
  );
  if (!result.ok) throw new OperationsServiceError(result.message, 422, { table: result.message });
  return { table: result.table };
}
