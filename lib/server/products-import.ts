import "server-only";

import { z } from "zod";

import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { computePriceHTFromTTC } from "@/lib/product-pricing";
import { prisma } from "@/lib/prisma";
import { roundMoney } from "@/lib/server/sales-shared";
import { OperationsServiceError } from "@/lib/server/depots";

/**
 * Shared foundation for the products Excel import (feuille "produits").
 *
 * Both endpoints go through classifyProductImportRows() so they can never
 * drift apart:
 *   - POST /api/produits/import/preview -> read-only, shows what would happen
 *   - POST /api/produits/import         -> the real write; it re-runs the
 *     classification itself and acts on THAT result, never on the statuses
 *     the browser sent.
 *
 * Everything is scoped to one organizationId (the caller's session) and one
 * depot StockLocation (the caller's own depot - see resolveImportDepotTarget).
 */

/** A file with more lines than this is rejected outright (§21 - "plusieurs
 * centaines ou milliers"). */
export const PRODUCT_IMPORT_MAX_ROWS = 5000;

export const productImportRowSchema = z.object({
  excelRow: z.number().int().positive(),
  reference: z.string().trim().min(1),
  supplierCode: z.string().trim().min(1),
  name: z.string().trim().min(1),
  categoryName: z.string().trim().min(1),
  // Prices are the tax-INCLUDED values from the file; HT is derived below.
  purchasePriceTTC: z.number().finite().min(0).max(MONEY_RANGE_MAX_NUMBER),
  salePriceTTC: z.number().finite().min(0).max(MONEY_RANGE_MAX_NUMBER),
  // Percentage, never a fraction: 20 = 20 %.
  taxRate: z.number().finite().min(0).max(100),
  // Target stock in the depot. Integer, MAY be negative (§12).
  targetStock: z.number().int(),
});

export const productImportSchema = z.object({
  rows: z.array(productImportRowSchema).max(PRODUCT_IMPORT_MAX_ROWS),
});

export type ProductImportRow = z.infer<typeof productImportRowSchema>;

export type ProductImportStatus =
  | "NEW"
  | "EXISTING_UNCHANGED"
  | "EXISTING_UPDATE"
  | "CONFLICT"
  | "ERROR";

export type ProductImportChange = { old: string | null; new: string | null };

export type ClassifiedProductRow = ProductImportRow & {
  /** Derived tax-excluded prices, stored as-is on Product (same convention
   * as the product form + /achats: computePriceHTFromTTC). */
  purchasePriceHT: number;
  salePriceHT: number;
  supplierId: string | null;
  supplierName: string | null;
  /** Resolved existing category id, or null when it will be created. */
  categoryId: string | null;
  categoryCreate: boolean;
  /** Depot stock today; null for a brand-new product. */
  currentStock: number | null;
  /** Existing Product id (only for EXISTING_*). Always from the org-scoped
   * preload, never from the request body. */
  existingId: string | null;
  status: ProductImportStatus;
  message: string;
  changes: Record<string, ProductImportChange>;
};

export type ProductImportSummary = {
  total: number;
  new: number;
  unchanged: number;
  update: number;
  conflicts: number;
  errors: number;
};

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

/** trim + lowercase + collapse spaces, so "Jus", " jus ", "JUS" collide. */
export function normalizeCategoryKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const money2 = (value: number) => roundMoney(value);

/**
 * One bulk preload per table (no N+1, §21), then a pure in-memory compare:
 *   - reference used twice in the file          -> CONFLICT (both rows)
 *   - supplier code unknown / inactive          -> ERROR
 *   - no product with that reference            -> NEW
 *   - product exists, every compared field same -> EXISTING_UNCHANGED
 *   - product exists, something differs         -> EXISTING_UPDATE (+changes)
 * Compared fields for UPDATE: name, supplier, category, purchasePrice HT,
 * salePrice HT, taxRate, target stock (§9).
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

  const productByRef = new Map(products.map((product) => [product.reference, product]));
  const supplierByCode = new Map(suppliers.map((supplier) => [supplier.code, supplier]));
  const categoryByKey = new Map(
    categories.map((category) => [normalizeCategoryKey(category.name), category]),
  );
  const stockByProduct = new Map(levels.map((level) => [level.productId, level.quantity]));

  const referenceCounts = new Map<string, number>();
  for (const row of rows) {
    referenceCounts.set(row.reference, (referenceCounts.get(row.reference) ?? 0) + 1);
  }

  const classified: ClassifiedProductRow[] = rows.map((row) => {
    const purchasePriceHT = computePriceHTFromTTC(row.purchasePriceTTC, row.taxRate);
    const salePriceHT = computePriceHTFromTTC(row.salePriceTTC, row.taxRate);
    const supplier = supplierByCode.get(row.supplierCode) ?? null;
    const category = categoryByKey.get(normalizeCategoryKey(row.categoryName)) ?? null;

    const base = {
      ...row,
      purchasePriceHT,
      salePriceHT,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? null,
      categoryId: category?.id ?? null,
      categoryCreate: !category,
      currentStock: null as number | null,
      existingId: null as string | null,
      changes: {} as Record<string, ProductImportChange>,
    };

    if ((referenceCounts.get(row.reference) ?? 0) > 1) {
      return { ...base, status: "CONFLICT", message: "Référence en double dans le fichier." };
    }
    if (!supplier) {
      return { ...base, status: "ERROR", message: `Fournisseur introuvable : ${row.supplierCode}` };
    }
    if (!supplier.active) {
      return { ...base, status: "ERROR", message: `Fournisseur inactif : ${row.supplierCode}` };
    }

    const existing = productByRef.get(row.reference);
    if (!existing) {
      return { ...base, status: "NEW", message: "Nouveau produit." };
    }

    const currentStock = stockByProduct.get(existing.id) ?? 0;
    const changes: Record<string, ProductImportChange> = {};

    if (existing.name !== row.name) {
      changes.name = { old: existing.name, new: row.name };
    }
    if (existing.defaultSupplierId !== supplier.id) {
      changes.supplier = { old: existing.defaultSupplier?.name ?? null, new: supplier.name };
    }
    const sameCategory = category ? category.id === existing.categoryId : false;
    if (!sameCategory) {
      changes.category = { old: existing.category?.name ?? null, new: row.categoryName };
    }
    if (money2(existing.purchasePrice.toNumber()) !== money2(purchasePriceHT)) {
      changes.purchasePriceHT = {
        old: money2(existing.purchasePrice.toNumber()).toString(),
        new: money2(purchasePriceHT).toString(),
      };
    }
    if (money2(existing.salePrice.toNumber()) !== money2(salePriceHT)) {
      changes.salePriceHT = {
        old: money2(existing.salePrice.toNumber()).toString(),
        new: money2(salePriceHT).toString(),
      };
    }
    if (money2(existing.taxRate.toNumber()) !== money2(row.taxRate)) {
      changes.taxRate = {
        old: existing.taxRate.toNumber().toString(),
        new: row.taxRate.toString(),
      };
    }
    if (currentStock !== row.targetStock) {
      changes.stock = { old: currentStock.toString(), new: row.targetStock.toString() };
    }

    const hasChanges = Object.keys(changes).length > 0;
    return {
      ...base,
      currentStock,
      existingId: existing.id,
      changes,
      status: hasChanges ? "EXISTING_UPDATE" : "EXISTING_UNCHANGED",
      message: hasChanges ? "Mise à jour détectée." : "Produit inchangé.",
    };
  });

  const count = (status: ProductImportStatus) =>
    classified.filter((row) => row.status === status).length;

  return {
    rows: classified,
    summary: {
      total: classified.length,
      new: count("NEW"),
      unchanged: count("EXISTING_UNCHANGED"),
      update: count("EXISTING_UPDATE"),
      conflicts: count("CONFLICT"),
      errors: count("ERROR"),
    },
  };
}
