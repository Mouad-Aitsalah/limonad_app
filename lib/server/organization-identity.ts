import "server-only";

import { prisma } from "@/lib/prisma";
import { validateLogoDataUrl } from "@/lib/logo-validation";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";

/**
 * "Identité de l'entreprise" - the current organisation's display name and
 * logo. Read by any authenticated member (the sidebar and the sales ticket
 * use it); only an admin can change the logo. Everything is scoped to the
 * caller's own organisation: `where: { id: user.organizationId }` - one
 * organisation can never read or write another's logo.
 */

export type OrganizationIdentity = {
  id: string;
  name: string;
  tradeName: string | null;
  logoUrl: string | null;
};

async function readIdentity(organizationId: string): Promise<OrganizationIdentity> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, tradeName: true, logoUrl: true },
  });
  if (!organization) {
    throw new AuthServiceError("Organisation introuvable.", 404);
  }
  return organization;
}

export async function getCurrentOrganizationIdentity(): Promise<OrganizationIdentity> {
  const user = await requireOrganizationUser([
    "admin",
    "depot_manager",
    "cashier",
    "driver",
  ]);
  return readIdentity(user.organizationId);
}

/** Admin-only variant for the /parametres/identite page loader. */
export async function getOrganizationIdentityForAdmin(): Promise<OrganizationIdentity> {
  const user = await requireOrganizationUser(["admin"]);
  return readIdentity(user.organizationId);
}

/**
 * Sets or clears the organisation logo. `logoDataUrl` must be a
 * `data:image/(png|jpeg|webp);base64,...` string within the size limit (see
 * lib/logo-validation.ts) - anything else is a 422. `null` clears it.
 */
export async function updateCurrentOrganizationLogo(
  logoDataUrl: string | null,
): Promise<OrganizationIdentity> {
  const user = await requireOrganizationUser(["admin"]);

  let value: string | null = null;
  if (typeof logoDataUrl === "string" && logoDataUrl.trim().length > 0) {
    const result = validateLogoDataUrl(logoDataUrl);
    if (!result.ok) {
      throw new OperationsServiceError(result.message, 422, { logo: result.message });
    }
    value = logoDataUrl.trim();
  }

  const organization = await prisma.organization.update({
    where: { id: user.organizationId },
    data: { logoUrl: value },
    select: { id: true, name: true, tradeName: true, logoUrl: true },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      action: value ? "ORGANIZATION_LOGO_SET" : "ORGANIZATION_LOGO_CLEARED",
      entityType: "Organization",
      entityId: organization.id,
      // Never store the image bytes in the audit log - just the fact.
      newValue: { hasLogo: Boolean(value) },
    },
  });

  return organization;
}
