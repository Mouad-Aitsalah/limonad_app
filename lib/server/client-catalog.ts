import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computePriceTTC } from "@/lib/product-pricing";
import { toLightweightProductImageUrl } from "@/lib/server/product-image-url";
import type { ClientCatalogDto, ClientOrganizationIdentityDto } from "@/types/client-portal";

/**
 * CLIENT PLATFORM (branch `client-platform`) - the customer-facing catalog.
 *
 * SECURITY: `organizationId` is a plain function parameter, taken by every
 * caller ONLY from the verified client session (lib/server/client-auth.ts's
 * getCurrentClient/requireClient) - never from a route param, a query
 * string or a request body. Every query below filters by it explicitly;
 * there is no code path here that can return another organisation's data.
 */
export async function getClientCatalog(organizationId: string): Promise<ClientCatalogDto> {
  const [organization, categories, products, stockRows] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, tradeName: true, logoUrl: true },
    }),
    prisma.category.findMany({
      where: { organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        categoryId: true,
        category: { select: { name: true } },
        salePrice: true,
        taxRate: true,
        imageUrl: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    // Aggregate, organisation-wide availability only - never a per-location
    // breakdown and never the raw quantity (see ClientCatalogProductDto's own
    // doc comment on why only a boolean is exposed here).
    prisma.$queryRaw<Array<{ productId: string; available: boolean }>>(Prisma.sql`
      SELECT sl."productId" AS "productId",
             (SUM(sl.quantity - sl."reservedQuantity") > 0) AS available
      FROM "StockLevel" sl
      JOIN "StockLocation" loc ON loc.id = sl."locationId"
      WHERE sl."organizationId" = ${organizationId}
        AND loc."organizationId" = ${organizationId}
      GROUP BY sl."productId"
    `),
  ]);

  const availabilityByProduct = new Map(stockRows.map((row) => [row.productId, row.available]));

  return {
    organization: {
      name: organization.name,
      tradeName: organization.tradeName,
      logoUrl: organization.logoUrl,
    },
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      priceTTC: computePriceTTC(product.salePrice.toNumber(), product.taxRate.toNumber()),
      imageUrl: toLightweightProductImageUrl(product.id, product.imageUrl, product.updatedAt),
      // No StockLevel row at all -> not known to be available; a product is
      // only ever shown as available when it demonstrably has stock.
      available: availabilityByProduct.get(product.id) ?? false,
    })),
  };
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
