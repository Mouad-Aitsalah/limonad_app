import type { Prisma } from "@/lib/generated/prisma/client";
import { resolveApiModuleRule } from "@/lib/modules/api-rules";
import type { ModuleKey } from "@/lib/modules/registry";
import {
  disabledModulesFromSettings,
  isAnyModuleEnabled,
  resolveModuleStates,
  validateModuleSettingsInput,
  type ModuleState,
} from "@/lib/modules/settings";

/**
 * Database / decision core of the organisation modules, with the database
 * injected (no session, no "server-only") so the tests run it for real on the
 * test database. The guarded entry points (SUPER_ADMIN check, session) are in
 * lib/server/organization-modules.ts and lib/server/module-guard.ts.
 */

export type ModulesDb = Pick<Prisma.TransactionClient, "organization" | "auditLog">;

export async function readOrganizationDisabledModules(
  db: Pick<Prisma.TransactionClient, "organization">,
  organizationId: string,
): Promise<ModuleKey[]> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { moduleSettings: true },
  });
  return disabledModulesFromSettings(organization?.moduleSettings);
}

export type WriteModulesResult =
  | { ok: true; organizationId: string; modules: ModuleState[] }
  | { ok: false; status: 404 | 422; message: string };

/**
 * Stores the SUPER_ADMIN's choice for ONE organisation (the one named, never
 * another) and writes the audit entry. The caller has already checked the
 * SUPER_ADMIN role.
 */
export async function writeOrganizationModuleSettings(
  db: ModulesDb,
  { organizationId, actorUserId, input }: { organizationId: string; actorUserId: string; input: unknown },
): Promise<WriteModulesResult> {
  const validation = validateModuleSettingsInput(input);
  if (!validation.ok) return { ok: false, status: 422, message: validation.message };

  const before = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, moduleSettings: true },
  });
  if (!before) return { ok: false, status: 404, message: "Organisation introuvable." };

  const organization = await db.organization.update({
    where: { id: before.id },
    data: { moduleSettings: validation.settings as unknown as Prisma.InputJsonObject },
    select: { id: true, moduleSettings: true },
  });

  await db.auditLog.create({
    data: {
      organizationId: organization.id,
      userId: actorUserId,
      action: "ORGANIZATION_MODULES_UPDATED",
      entityType: "Organization",
      entityId: organization.id,
      oldValue: { disabledModules: disabledModulesFromSettings(before.moduleSettings) },
      newValue: { disabledModules: disabledModulesFromSettings(organization.moduleSettings) },
    },
  });

  return { ok: true, organizationId: organization.id, modules: resolveModuleStates(organization.moduleSettings) };
}

export type ApiModuleDecision =
  | { allowed: true; reason: "essential" | "no-organisation" | "enabled" }
  | { allowed: false; reason: "unmapped" | "disabled"; modules: readonly ModuleKey[] };

/**
 * The decision of rejectDisabledModule(), from the request's own path and
 * method and the caller's organisation state. A route missing from the rules
 * is refused (fail closed); a caller without an organisation session is let
 * through to the route's own authentication (401 / 403, as before).
 */
export function decideApiModuleAccess({
  pathname,
  method,
  organizationId,
  disabledModules,
}: {
  pathname: string;
  method: string;
  organizationId: string | null | undefined;
  disabledModules: readonly string[] | undefined;
}): ApiModuleDecision {
  const rule = resolveApiModuleRule(pathname, method);
  if (!rule) return { allowed: false, reason: "unmapped", modules: [] };
  if (rule.essential !== undefined) return { allowed: true, reason: "essential" };
  if (!organizationId) return { allowed: true, reason: "no-organisation" };
  return isAnyModuleEnabled(disabledModules, rule.modules)
    ? { allowed: true, reason: "enabled" }
    : { allowed: false, reason: "disabled", modules: rule.modules };
}
