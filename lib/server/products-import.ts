import "server-only";

import { prisma } from "@/lib/prisma";
import {
  classifyPreloadedRows,
  type ClassifiedProductRow,
  type ProductImportRow,
  type ProductImportSummary,
} from "@/lib/products-import-rules";
import { OperationsServiceError } from "@/lib/server/depots";

/**
 * Server side of the products Excel import (feuille "produits").
 *
 * Both endpoints go through classifyProductImportRows() so they can never
 * drift apart:
 *   - POST /api/produits/import/preview -> read-only, classifies the WHOLE file
 *     in one request (so a reference used twice is a conflict file-wide)
 *   - POST /api/produits/import         -> the real write, one BATCH of lines
 *     per request; it re-runs the classification on the batch itself and acts
 *     on THAT result, never on the statuses the browser sent.
 *
 * Everything is scoped to one organizationId (the caller's session) and one
 * depot StockLocation (the caller's own depot - see resolveImportDepotTarget).
 *
 * The row contract, the schemas and the pure comparison live in
 * lib/products-import-rules.ts (unchanged rules, database-free so they can be
 * tested); they are re-exported here so every existing import keeps working.
 */
export {
  PRODUCT_IMPORT_MAX_ROWS,
} from "@/lib/products-import-shared";
export {
  normalizeCategoryKey,
  productImportBatchSchema,
  productImportRowSchema,
  productImportSchema,
  type ClassifiedProductRow,
  type ProductImportChange,
  type ProductImportRow,
  type ProductImportStatus,
  type ProductImportSummary,
} from "@/lib/products-import-rules";

export type ImportDepotTarget = {
  locationId: string;
  depotId: string;
  depotName: string;
  depotCode: string;
};

/**
 * The depot the import writes stock into: the caller's own assigned depot,
 * exactly like /achats (createPurchase resolves user.depotId -> the DEPOT
 * StockLocation). Never a parameter, so an import can't target another
 * depot - or another organisation.
 */
export async function resolveImportDepotTarget(
  organizationId: string,
  userId: string,
): Promise<ImportDepotTarget> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: {
      depotId: true,
      depot: { select: { id: true, name: true, code: true, active: true } },
    },
  });
  if (!user?.depotId || !user.depot) {
    throw new OperationsServiceError(
      "Aucun dépôt n'est associé à votre utilisateur.",
      409,
    );
  }
  if (!user.depot.active) {
    throw new OperationsServiceError(
      "Le dépôt associé à votre utilisateur est inactif.",
      409,
    );
  }
  const location = await prisma.stockLocation.findFirst({
    where: { organizationId, depotId: user.depotId, type: "DEPOT" },
    select: { id: true, active: true },
  });
  if (!location || !location.active) {
    throw new OperationsServiceError(
      "L'emplacement de stock du dépôt est introuvable ou inactif.",
      409,
    );
  }
  return {
    locationId: location.id,
    depotId: user.depot.id,
    depotName: user.depot.name,
    depotCode: user.depot.code,
  };
}

/**
 * One bulk preload per table (no N+1, §21), then the pure in-memory compare of
 * classifyPreloadedRows (see lib/products-import-rules.ts for the rules).
 * 4 grouped Prisma reads whatever the number of lines (6 SQL SELECTs measured,
 * the relations being fetched on the side): products by reference, suppliers by
 * code, the organisation's categories, and the depot stock of the products found.
 */
export async function classifyProductImportRows(
  organizationId: string,
  locationId: string,
  rows: ProductImportRow[],
): Promise<{ rows: ClassifiedProductRow[]; summary: ProductImportSummary }> {
  const references = [...new Set(rows.map((row) => row.reference))];
  const supplierCodes = [...new Set(rows.map((row) => row.supplierCode))];

  const [products, suppliers, categories] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId, reference: { in: references } },
      select: {
        id: true,
        reference: true,
        name: true,
        defaultSupplierId: true,
        defaultSupplier: { select: { name: true } },
        categoryId: true,
        category: { select: { name: true } },
        purchasePrice: true,
        salePrice: true,
        taxRate: true,
      },
    }),
    prisma.supplier.findMany({
      where: { organizationId, code: { in: supplierCodes } },
      select: { id: true, code: true, name: true, active: true },
    }),
    prisma.category.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    }),
  ]);

  const productIds = products.map((product) => product.id);
  const levels = productIds.length
    ? await prisma.stockLevel.findMany({
        where: { organizationId, locationId, productId: { in: productIds } },
        select: { productId: true, quantity: true },
      })
    : [];

  return classifyPreloadedRows(rows, {
    products: products.map((product) => ({
      id: product.id,
      reference: product.reference,
      name: product.name,
      defaultSupplierId: product.defaultSupplierId,
      defaultSupplierName: product.defaultSupplier?.name ?? null,
      categoryId: product.categoryId,
      categoryName: product.category?.name ?? null,
      purchasePrice: product.purchasePrice.toNumber(),
      salePrice: product.salePrice.toNumber(),
      taxRate: product.taxRate.toNumber(),
    })),
    suppliers,
    categories,
    stockByProduct: new Map(levels.map((level) => [level.productId, level.quantity])),
  });
}
