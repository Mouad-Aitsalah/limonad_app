import "server-only";

import type { CurrentUser, UserRole } from "@/types/auth";

import { AuthServiceError, requireSessionUser } from "@/lib/server/auth";

export type OrganizationSessionUser = CurrentUser & {
  organizationId: string;
};

export async function requireSuperAdmin() {
  return requireSessionUser(["super_admin"]);
}

export async function requireOrganizationUser(
  allowedRoles?: UserRole[],
): Promise<OrganizationSessionUser> {
  const user = await requireSessionUser(allowedRoles);
  return asOrganizationUser(user);
}

export function asOrganizationUser(user: CurrentUser): OrganizationSessionUser {
  if (!user.organizationId) {
    throw new AuthServiceError(
      "Aucune organisation n'est associee a cette session.",
      403,
    );
  }

  return user as OrganizationSessionUser;
}

export function assertSameOrganization(
  currentOrganizationId: string,
  targetOrganizationId: string | null | undefined,
  message = "Acces non autorise a cette organisation.",
) {
  if (!targetOrganizationId || targetOrganizationId !== currentOrganizationId) {
    throw new AuthServiceError(message, 403);
  }
}

export function withOrganizationScope<T extends Record<string, unknown>>(
  organizationId: string,
  where?: T,
) {
  return {
    ...(where ?? {}),
    organizationId,
  } as T & { organizationId: string };
}
