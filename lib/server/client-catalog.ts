import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getClientCatalogCategories,
  getClientCatalogPage,
} from "@/lib/server/client-portal-core";
import type { ClientCatalogDto, ClientOrganizationIdentityDto } from "@/types/client-portal";

/**
 * Espace Client - the customer-facing catalogue (see client-portal-core.ts
 * for the filtering rules: ACTIVE products of the organisation that have a
 * valid photo, filtered and paginated in the database).
 *
 * SECURITY: `organizationId` is a plain function parameter, taken by every
 * caller ONLY from the verified client session (lib/server/client-auth.ts's
 * getCurrentClient/requireClient) - never from a route param, a query
 * string or a request body.
 */
export async function getClientCatalog(organizationId: string): Promise<ClientCatalogDto> {
  const [organization, categories, firstPage] = await Promise.all([
    getClientOrganizationIdentity(organizationId),
    getClientCatalogCategories(prisma, organizationId),
    getClientCatalogPage(prisma, organizationId),
  ]);
  return { organization, categories, firstPage };
}

/**
 * Lightweight sibling of getClientCatalog for pages that only need the
 * organisation's identity (e.g. the cart page header) - same SECURITY rule:
 * `organizationId` comes only from the verified client session.
 */
export async function getClientOrganizationIdentity(organizationId: string): Promise<ClientOrganizationIdentityDto> {
  return prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, tradeName: true, logoUrl: true },
  });
}
