import "server-only";

import { readOrganizationDisabledModules, writeOrganizationModuleSettings } from "@/lib/modules/module-access-core";
import { MODULES } from "@/lib/modules/registry";
import { isModuleEnabled, type ModuleState } from "@/lib/modules/settings";
import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireSuperAdmin } from "@/lib/server/organization-context";

/**
 * "Modules autorisés" of ONE organisation (Organisations -> detail). SUPER_ADMIN
 * only, enforced here whatever the UI shows: an ADMIN (or anyone else) gets a
 * 403 and can never re-enable a module the SUPER_ADMIN disabled. Only the
 * organisation named in the URL is read or written - the others are never
 * touched. Disabling a module never deletes any of its data. Audited.
 * The database work is in lib/modules/module-access-core.ts.
 */

export type OrganizationModulesDto = {
  organizationId: string;
  modules: ModuleState[];
};

export async function getOrganizationModules(organizationId: string): Promise<OrganizationModulesDto> {
  await requireSuperAdmin();
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw new OperationsServiceError("Organisation introuvable.", 404);
  const disabled = await readOrganizationDisabledModules(prisma, organization.id);
  return {
    organizationId: organization.id,
    modules: MODULES.map((module) => ({ key: module.key, enabled: isModuleEnabled(disabled, module.key) })),
  };
}

/** Body: { modules: { [module key]: boolean } } - the full choice (a missing module = enabled). */
export async function updateOrganizationModules(
  organizationId: string,
  input: unknown,
): Promise<OrganizationModulesDto> {
  const superAdmin = await requireSuperAdmin();
  const result = await writeOrganizationModuleSettings(prisma, {
    organizationId,
    actorUserId: superAdmin.id,
    input,
  });
  if (!result.ok) {
    throw new OperationsServiceError(result.message, result.status, { modules: result.message });
  }
  return { organizationId: result.organizationId, modules: result.modules };
}
