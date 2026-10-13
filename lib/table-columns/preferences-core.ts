import type { Prisma } from "@/lib/generated/prisma/client";
import {
  findConfigurableTable,
  isDefaultTableColumnPreference,
  parseTableColumnPreferences,
  sanitizeTableColumnPreference,
  type TableColumnPreference,
  type TableColumnPreferences,
} from "@/lib/table-columns/columns";

/**
 * Database core of the per-user column preferences, with the database injected
 * (no session, no "server-only") so the tests run it on the test database. The
 * scope - the caller's own user id AND organisation - is decided by the guarded
 * entry points (lib/server/table-preferences.ts, from the session) and every
 * query here filters on BOTH: another user's preferences, or the same user's
 * in another organisation, are never read or written.
 */

export type PreferencesDb = Pick<Prisma.TransactionClient, "userTablePreference">;
export type PreferenceScope = { userId: string; organizationId: string };

export async function readUserTablePreferences(
  db: PreferencesDb,
  scope: PreferenceScope,
): Promise<TableColumnPreferences> {
  const rows = await db.userTablePreference.findMany({
    where: { userId: scope.userId, organizationId: scope.organizationId },
    select: { tableKey: true, settings: true },
  });
  return parseTableColumnPreferences(rows);
}

export type SavePreferenceResult =
  | { ok: true; table: string; preference: TableColumnPreference }
  | { ok: false; message: string };

/**
 * Body: { table, order: [keys], hidden: [keys] }. The preference is cleaned
 * (unknown columns dropped, required columns never hidden). A choice equal to
 * the default removes the row instead of storing it.
 */
export async function saveUserTablePreference(
  db: PreferencesDb,
  scope: PreferenceScope,
  input: unknown,
): Promise<SavePreferenceResult> {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const definition = typeof body.table === "string" ? findConfigurableTable(body.table) : undefined;
  if (!definition) return { ok: false, message: "Tableau inconnu." };
  const preference = sanitizeTableColumnPreference(definition, body);
  const owned = { userId: scope.userId, organizationId: scope.organizationId, tableKey: definition.key };

  if (isDefaultTableColumnPreference(definition, preference)) {
    await db.userTablePreference.deleteMany({ where: owned });
  } else {
    const settings = preference as unknown as Prisma.InputJsonObject;
    await db.userTablePreference.upsert({
      where: { userId_organizationId_tableKey: owned },
      create: { ...owned, settings },
      update: { settings },
      select: { id: true },
    });
  }
  return { ok: true, table: definition.key, preference };
}

/** "Restaurer les colonnes par défaut": removes the caller's own row for that table. */
export async function resetUserTablePreference(
  db: PreferencesDb,
  scope: PreferenceScope,
  table: unknown,
): Promise<{ ok: true; table: string } | { ok: false; message: string }> {
  const definition = typeof table === "string" ? findConfigurableTable(table) : undefined;
  if (!definition) return { ok: false, message: "Tableau inconnu." };
  await db.userTablePreference.deleteMany({
    where: { userId: scope.userId, organizationId: scope.organizationId, tableKey: definition.key },
  });
  return { ok: true, table: definition.key };
}
