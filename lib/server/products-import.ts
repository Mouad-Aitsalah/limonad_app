import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  ClassifiedProductRow,
  ProductImportRow,
  ProductImportSummary,
  ResolvedCreationDefaults,
} from "@/lib/products-import-rules";
import type { ExternalVariantError, VariantGroupSummary } from "@/lib/products-import-variant-groups";
import { OperationsServiceError } from "@/lib/server/depots";
import { classifyProductImportRowsWith } from "@/lib/server/products-import-core";

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
  creationDefaultsSchema,
  externalVariantErrorSchema,
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
 * Classifies the lines against the organisation's data (see
 * lib/server/products-import-core.ts for the preload and
 * lib/products-import-rules.ts for the rules). `applyStock` is the user's
 * explicit choice: without it QuantiteStock is only reported, never written.
 */
export async function classifyProductImportRows(
  organizationId: string,
  locationId: string,
  rows: ProductImportRow[],
  options: {
    applyStock: boolean;
    creationDefaults?: ResolvedCreationDefaults;
    externalErrors?: readonly ExternalVariantError[];
    /** The write: every variants line must declare its group size. */
    requireGroupSize?: boolean;
  },
): Promise<{ rows: ClassifiedProductRow[]; summary: ProductImportSummary; groups: VariantGroupSummary[] }> {
  return classifyProductImportRowsWith(prisma, organizationId, locationId, rows, options);
}

/**
 * The creation defaults of the request (variants format: no supplier / VAT column),
 * checked: the supplier must be an ACTIVE supplier of the caller's organisation -
 * it is looked up by id, scoped to the organisation, and never created here. The
 * classification then uses its code. Read-only.
 */
export async function resolveCreationDefaults(
  organizationId: string,
  defaults: { supplierId?: string; taxRate?: number } | undefined,
): Promise<ResolvedCreationDefaults | undefined> {
  if (!defaults) return undefined;
  const resolved: ResolvedCreationDefaults = {};
  if (defaults.taxRate !== undefined) resolved.taxRate = defaults.taxRate;
  if (defaults.supplierId !== undefined) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: defaults.supplierId, organizationId },
      select: { code: true, active: true },
    });
    if (!supplier) throw new OperationsServiceError("Fournisseur par défaut introuvable dans votre organisation.", 422);
    if (!supplier.active) throw new OperationsServiceError("Le fournisseur par défaut est inactif.", 422);
    resolved.supplierCode = supplier.code;
  }
  return resolved;
}
