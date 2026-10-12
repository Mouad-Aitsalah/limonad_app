import "server-only";

import { ACCOUNT_TYPES, type AccountTypeCode } from "@/lib/import-export/accounts-format";
import { prisma } from "@/lib/prisma";
import { loadAccountsExportPage } from "@/lib/server/accounts-export-core";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { resolveImportDepotTarget } from "@/lib/server/products-import";
import { applyProductPhotos, loadProductExportPhotos, loadProductsExportPage, type ProductExportFilters } from "@/lib/server/products-export-core";

/**
 * Entry points of the products / accounts EXPORTS and of the product photo
 * IMPORT. Roles enforced here, whatever the page shows:
 *   - exports: admin only;
 *   - photo import: the roles of the products import (admin, depot_manager).
 * The organisation always comes from the session; the first page of an export
 * is written to the audit log (who exported what, with which filters).
 */

export const EXPORT_ROLES = ["admin"] as const;
export const PRODUCT_IMPORT_ROLES = ["admin", "depot_manager"] as const;

export async function exportProductsPage(params: {
  filters: ProductExportFilters;
  cursor: string | null;
  withStock: boolean;
  withPhotos: boolean;
}) {
  const user = await requireOrganizationUser([...EXPORT_ROLES]);
  // QuantiteStock = the exporting user's depot, the importer's own semantics.
  let depot: { locationId: string; name: string } | null = null;
  if (params.withStock) {
    const target = await resolveImportDepotTarget(user.organizationId, user.id);
    depot = { locationId: target.locationId, name: target.depotName };
  }
  const page = await loadProductsExportPage(prisma, user.organizationId, {
    filters: params.filters,
    cursor: params.cursor,
    depotLocationId: depot?.locationId ?? null,
  });
  if (!params.cursor) {
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: "PRODUCTS_EXPORTED",
        entityType: "Product",
        newValue: { filters: params.filters, withStock: params.withStock, withPhotos: params.withPhotos, total: page.total },
      },
    });
  }
  return { ...page, depotName: depot?.name ?? null };
}

export async function exportProductPhotos(references: string[]) {
  const user = await requireOrganizationUser([...EXPORT_ROLES]);
  if (references.length > 500) throw new OperationsServiceError("Trop de références dans une seule demande (500 maximum).", 422);
  return loadProductExportPhotos(prisma, user.organizationId, references);
}

export async function exportAccountsPage(params: { type: string; cursor: string | null; includeGps: boolean }) {
  const user = await requireOrganizationUser([...EXPORT_ROLES]);
  if (!(ACCOUNT_TYPES as readonly string[]).includes(params.type)) {
    throw new OperationsServiceError("Type de compte inconnu.", 422);
  }
  const type = params.type as AccountTypeCode;
  const page = await loadAccountsExportPage(prisma, user.organizationId, { type, cursor: params.cursor, includeGps: params.includeGps });
  if (!params.cursor) {
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: "ACCOUNTS_EXPORTED",
        entityType: "BusinessAccount",
        newValue: { type, includeGps: params.includeGps },
      },
    });
  }
  return page;
}

/** Max photos per request (the browser also keeps each request under ~3 MB). */
export const PHOTO_IMPORT_MAX_ITEMS = 40;

export async function importProductPhotos(items: Array<{ reference: string; dataUrl: string }>) {
  const user = await requireOrganizationUser([...PRODUCT_IMPORT_ROLES]);
  if (items.length === 0) throw new OperationsServiceError("Aucune photo à importer.", 422);
  if (items.length > PHOTO_IMPORT_MAX_ITEMS) {
    throw new OperationsServiceError(`Trop de photos dans une seule demande (${PHOTO_IMPORT_MAX_ITEMS} maximum).`, 422);
  }
  const results = await applyProductPhotos(prisma, user.organizationId, items);
  await prisma.auditLog.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      action: "PRODUCT_PHOTOS_IMPORTED",
      entityType: "Product",
      newValue: {
        received: items.length,
        updated: results.filter((row) => row.status === "UPDATED").length,
        rejected: results.filter((row) => row.status === "INVALID" || row.status === "NOT_FOUND").length,
      },
    },
  });
  return results;
}
