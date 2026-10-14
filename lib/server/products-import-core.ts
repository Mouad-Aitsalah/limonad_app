import { Prisma } from "@/lib/generated/prisma/client";
import {
  classifyPreloadedRows,
  importedProductFields,
  variantIdentityKey,
  type ClassifiedProductRow,
  type ProductImportRow,
  type ProductImportSummary,
  type ResolvedCreationDefaults,
} from "@/lib/products-import-rules";
import {
  finalizeVariantGroups,
  prepareVariantRows,
  type ExternalVariantError,
  type VariantGroupSummary,
} from "@/lib/products-import-variant-groups";
import { variantGroupKeyOf, variantKeyOf } from "@/lib/products-import-variants";
import type { ImportLineTx } from "@/lib/products-import-writer";
import { OperationsServiceError } from "@/lib/server/service-error";

/**
 * The database side of the products import, for ONE organisation and ONE depot
 * StockLocation that the caller has already authorised and resolved
 * (lib/server/products-import.ts / products-import-apply.ts). The client is
 * injected - the real one, or a transaction the tests roll back - and so are
 * the two document-number generators (category code, stock movement number),
 * which live in server-only modules. Every query is scoped to `organizationId`
 * and the depot `locationId`; nothing ever comes from the file but business
 * values (reference, codes, names).
 */

type Db = Prisma.TransactionClient;

export type ImportSequences = {
  nextCategoryCode(tx: Db, organizationId: string): Promise<string>;
  nextMovementNumber(tx: Db, organizationId: string): Promise<string>;
  /** `count` consecutive movement numbers in ONE step (the same counter as nextMovementNumber). */
  nextMovementNumbers?(tx: Db, organizationId: string, count: number): Promise<string[]>;
};

/**
 * One bulk preload per table (no N+1, §21), then the pure in-memory compare of
 * classifyPreloadedRows (see lib/products-import-rules.ts for the rules):
 * products by reference, suppliers by code, the organisation's categories and
 * brands, the products holding a barcode of the file, the depot stock of the
 * products found, and - only for lines carrying an external photo URL - the
 * stored photo of those products.
 */
export async function classifyProductImportRowsWith(
  db: Db,
  organizationId: string,
  locationId: string,
  inputRows: ProductImportRow[],
  options: {
    applyStock: boolean;
    creationDefaults?: ResolvedCreationDefaults;
    externalErrors?: readonly ExternalVariantError[];
    /** The write: every variants line must declare its group's size. */
    requireGroupSize?: boolean;
  },
): Promise<{ rows: ClassifiedProductRow[]; summary: ProductImportSummary; groups: VariantGroupSummary[] }> {
  // Variants format: the designation and the reference are RECOMPUTED here from the
  // attributes (the lookups below use the recomputed ones). A file without any
  // variants line comes back untouched.
  const prepared = prepareVariantRows(inputRows);
  const rows = prepared.rows;
  const references = [...new Set(rows.map((row) => row.reference))];
  const supplierCodes = [
    ...new Set([
      ...rows.flatMap((row) => (row.supplierCode !== undefined ? [row.supplierCode] : [])),
      ...(options.creationDefaults?.supplierCode !== undefined ? [options.creationDefaults.supplierCode] : []),
    ]),
  ];
  const barcodes = [...new Set(rows.flatMap((row) => (row.barcode !== undefined ? [row.barcode] : [])))];
  const photoReferences = [...new Set(rows.flatMap((row) => (row.imageUrl !== undefined ? [row.reference] : [])))];

  // Variants format: the products that already hold one of the file's variant identities are read in the
  // SAME query as the products of the file's references (one read, whatever the number of lines).
  const identities = rows.flatMap((row) =>
    row.variantParentName !== undefined && row.variantAttributes !== undefined
      ? [{ groupKey: variantGroupKeyOf(row.variantParentName), key: variantKeyOf(row.variantAttributes) }]
      : [],
  );
  const identityGroupKeys = [...new Set(identities.map((identity) => identity.groupKey))];
  const identityKeys = [...new Set(identities.map((identity) => identity.key))];
  const productWhere: Prisma.ProductWhereInput = identities.length
    ? {
        organizationId,
        OR: [{ reference: { in: references } }, { variantGroupKey: { in: identityGroupKeys }, variantKey: { in: identityKeys } }],
      }
    : { organizationId, reference: { in: references } };

  const [foundProducts, suppliers, categories, brands, barcodeOwners, photos] = await Promise.all([
    db.product.findMany({
      where: productWhere,
      select: {
        id: true,
        reference: true,
        name: true,
        defaultSupplierId: true,
        defaultSupplier: { select: { name: true } },
        categoryId: true,
        category: { select: { name: true } },
        brandId: true,
        brand: { select: { name: true } },
        purchasePrice: true,
        salePrice: true,
        taxRate: true,
        retailPrice: true,
        semiWholesalePrice: true,
        semiWholesaleMinQty: true,
        wholesaleMinQty: true,
        unit: true,
        barcode: true,
        description: true,
        minimumStock: true,
        status: true,
        ...(identities.length ? { variantGroupKey: true, variantKey: true } : {}),
      },
    }),
    supplierCodes.length
      ? db.supplier.findMany({
          where: { organizationId, code: { in: supplierCodes } },
          select: { id: true, code: true, name: true, active: true },
        })
      : Promise.resolve([]),
    db.category.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.brand.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    barcodes.length
      ? db.product.findMany({ where: { organizationId, barcode: { in: barcodes } }, select: { barcode: true, reference: true } })
      : Promise.resolve([]),
    photoReferences.length
      ? db.product.findMany({ where: { organizationId, reference: { in: photoReferences } }, select: { reference: true, imageUrl: true } })
      : Promise.resolve([]),
  ]);

  // The products of the file's references; the others (identity matches only) are the variant owners.
  const referenceSet = new Set(references);
  const products = foundProducts.filter((product) => referenceSet.has(product.reference));
  const variantOwners = new Map<string, { id: string; reference: string; name: string }>();
  foundProducts.forEach((product) => {
    const stored = product as typeof product & { variantGroupKey?: string | null; variantKey?: string | null };
    if (stored.variantGroupKey && stored.variantKey && product.categoryId) {
      variantOwners.set(variantIdentityKey(product.categoryId, stored.variantGroupKey, stored.variantKey), {
        id: product.id,
        reference: product.reference,
        name: product.name,
      });
    }
  });

  const productIds = products.map((product) => product.id);
  const levels = productIds.length
    ? await db.stockLevel.findMany({
        where: { organizationId, locationId, productId: { in: productIds } },
        select: { productId: true, quantity: true },
      })
    : [];
  const photoByReference = new Map(photos.map((photo) => [photo.reference, photo.imageUrl]));

  const classified = classifyPreloadedRows(
    rows,
    {
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
        retailPrice: product.retailPrice ? product.retailPrice.toNumber() : null,
        semiWholesalePrice: product.semiWholesalePrice ? product.semiWholesalePrice.toNumber() : null,
        semiWholesaleMinQty: product.semiWholesaleMinQty,
        wholesaleMinQty: product.wholesaleMinQty,
        unit: product.unit,
        barcode: product.barcode,
        brandId: product.brandId,
        brandName: product.brand?.name ?? null,
        description: product.description,
        minimumStock: product.minimumStock,
        status: product.status,
        ...(identities.length
          ? {
              variant:
                (product as typeof product & { variantKey?: string | null }).variantKey && (product as typeof product & { variantGroupKey?: string | null }).variantGroupKey
                  ? {
                      groupKey: (product as typeof product & { variantGroupKey: string }).variantGroupKey,
                      key: (product as typeof product & { variantKey: string }).variantKey as string,
                    }
                  : null,
            }
          : {}),
        ...(photoByReference.has(product.reference) ? { imageUrl: photoByReference.get(product.reference) ?? null } : {}),
      })),
      suppliers,
      categories,
      brands,
      barcodeOwners: new Map(barcodeOwners.flatMap((owner) => (owner.barcode ? [[owner.barcode, owner.reference] as [string, string]] : []))),
      ...(identities.length ? { variantOwners } : {}),
      stockByProduct: new Map(levels.map((level) => [level.productId, level.quantity])),
    },
    { applyStock: options.applyStock, creationDefaults: options.creationDefaults },
  );
  if (!prepared.hasVariants) return { ...classified, groups: [] };
  return finalizeVariantGroups(classified, {
    problems: prepared.problems,
    externalErrors: options.externalErrors,
    requireGroupSize: options.requireGroupSize,
  });
}

/** The Prisma implementation of one line's work (see ImportLineTx), inside the line's transaction. */
export function productImportLineTx(
  tx: Db,
  organizationId: string,
  userId: string,
  locationId: string,
  sequences: ImportSequences,
  options: { deferMovements?: boolean } = {},
): ImportLineTx {
  // Group transaction: the stock level is changed line by line, but the movements are only RECORDED (and their
  // numbers reserved, in ONE step) by commitMovements at the very end of the group's work - so the movement
  // counter row is locked for a few milliseconds, not for the whole transaction.
  const pending: PendingMovement[] = [];
  return {
    findSupplierByCode: (code) =>
      tx.supplier.findFirst({
        where: { organizationId, code },
        select: { id: true, active: true },
      }),

    // Same fields as the other places that create a supplier (the "Comptes" form and
    // the accounts import): organisation, code, name, active, created by. Its
    // auxiliary ledger account is NOT created here - accounting creates it, as for
    // any supplier, on its first posted purchase (lib/server/accounting.ts).
    createSupplier: ({ code, name }) =>
      tx.supplier.create({
        data: { organizationId, code, name, active: true, createdByUserId: userId },
        select: { id: true },
      }),

    findCategoryByName: (name) =>
      tx.category.findFirst({
        where: { organizationId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      }),

    createCategory: async (name) => {
      const code = await sequences.nextCategoryCode(tx, organizationId);
      return tx.category.create({
        data: { organizationId, code, name, active: true },
        select: { id: true },
      });
    },

    findBrandByName: (name) =>
      tx.brand.findFirst({
        where: { organizationId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      }),

    // Brand has no code: name + organisation, active - like the product form's brands.
    createBrand: (name) =>
      tx.brand.create({
        data: { organizationId, name, active: true },
        select: { id: true },
      }),

    createProduct: (row, categoryId, supplierId, brandId) => createProductRow(tx, organizationId, row, categoryId, supplierId, brandId),

    updateProduct: (productId, row, categoryId, supplierId, brandId) =>
      updateProductRow(tx, organizationId, productId, row, categoryId, supplierId, brandId),

    syncStock: (productId, targetStock) =>
      syncStock(tx, organizationId, userId, locationId, productId, targetStock, sequences, options.deferMovements ? pending : null),

    commitMovements: () => commitMovements(tx, organizationId, userId, locationId, pending, sequences),
  };
}

async function createProductRow(
  tx: Db,
  organizationId: string,
  row: ClassifiedProductRow,
  categoryId: string,
  supplierId: string,
  brandId: string | null,
): Promise<string> {
  const product = await tx.product.create({
    data: {
      organizationId,
      reference: row.reference,
      name: row.name!,
      categoryId,
      defaultSupplierId: supplierId,
      brandId,
      purchasePrice: row.purchasePriceHT!,
      salePrice: row.salePriceHT!,
      taxRate: row.taxRate!,
      // Optional columns: absent -> no tier (NULL), the historical default unit,
      // minimum stock 0, ACTIVE, no photo.
      unit: "unité",
      minimumStock: 0,
      status: "ACTIVE",
      ...importedProductFields(row),
      ...variantCreateFields(row),
    },
    select: { id: true },
  });
  return product.id;
}

/** The four variant columns of a line that carries a variant identity (a line of the historical format has none). */
function variantCreateFields(row: ClassifiedProductRow) {
  const identity = row.variantIdentity;
  if (!identity) return {};
  return {
    variantParentName: identity.parentName,
    variantGroupKey: identity.groupKey,
    variantAttributes: identity.attributes as unknown as Prisma.InputJsonValue,
    variantKey: identity.key,
  };
}

async function updateProductRow(
  tx: Db,
  organizationId: string,
  id: string,
  row: ClassifiedProductRow,
  categoryId: string | null,
  supplierId: string | null,
  brandId: string | null,
): Promise<string> {
  const identity = row.variantIdentity;
  // The variant identity is touched in two cases only, and each is guarded IN the UPDATE so a race cannot slip through:
  //   - an ordinary product that matched exactly joins the group: only while its four variant columns are still NULL;
  //   - the same variant: only while it still holds the same identity (its display spelling may change).
  const variantGuard =
    identity && row.attachVariant
      ? { variantParentName: null, variantGroupKey: null, variantKey: null, variantAttributes: { equals: Prisma.DbNull } }
      : identity && row.existingVariant
        ? { variantGroupKey: identity.groupKey, variantKey: identity.key }
        : {};
  const variantData =
    identity && (row.attachVariant || row.existingVariant)
      ? row.attachVariant
        ? variantCreateFields(row)
        : { variantParentName: identity.parentName, variantAttributes: identity.attributes as unknown as Prisma.InputJsonValue }
      : {};
  const { count } = await tx.product.updateMany({
    where: { id, organizationId, ...variantGuard },
    data: {
      // Only what the file carries (absent column / empty cell -> stored value kept),
      // and the links only when the file names them.
      ...importedProductFields(row),
      ...variantData,
      ...(categoryId ? { categoryId } : {}),
      ...(supplierId ? { defaultSupplierId: supplierId } : {}),
      ...(brandId ? { brandId } : {}),
    },
  });
  if (count === 0) {
    if (identity && Object.keys(variantGuard).length) {
      throw new OperationsServiceError("Ce produit a changé entre l'aperçu et l'écriture (variante modifiée ou rattachée ailleurs) : relancez l'aperçu.", 409);
    }
    throw new OperationsServiceError("Produit introuvable au moment de la mise à jour.", 404);
  }
  return id;
}

/**
 * Import-only stock sync. QuantiteStock is a TARGET, never an addition:
 * delta = target - current, applied as one INVENTORY_ADJUSTMENT movement,
 * and skipped entirely when delta is 0 (idempotent re-import, §14). A
 * negative target IS allowed here - unlike createStockAdjustment /
 * applyStockMovement, whose "stock >= 0" guard is deliberately kept for
 * /stock and /inventaire. Returns true when a movement was written.
 * (Moved unchanged from lib/server/products-import-apply.ts.)
 */
type PendingMovement = { productId: string; delta: number; before: number; after: number };

function adjustmentNote(before: number, after: number, delta: number): string {
  return `ADJUSTMENT_SNAPSHOT:${JSON.stringify({ beforeQuantity: before, afterQuantity: after, deltaQuantity: delta })}`;
}

/**
 * Records the movements a group changed stock for: ONE reservation of consecutive numbers (the same counter as
 * every other movement) and ONE insert, at the end of the group's transaction. Nothing to do when no stock moved.
 */
async function commitMovements(
  tx: Db,
  organizationId: string,
  userId: string,
  locationId: string,
  pending: PendingMovement[],
  sequences: ImportSequences,
): Promise<void> {
  if (pending.length === 0) return;
  const movementNumbers: string[] = [];
  if (sequences.nextMovementNumbers) {
    movementNumbers.push(...(await sequences.nextMovementNumbers(tx, organizationId, pending.length)));
  } else {
    for (let index = 0; index < pending.length; index += 1) movementNumbers.push(await sequences.nextMovementNumber(tx, organizationId));
  }
  await tx.stockMovement.createMany({
    data: pending.map((movement, index) => ({
      organizationId,
      movementNumber: movementNumbers[index],
      type: "INVENTORY_ADJUSTMENT" as const,
      productId: movement.productId,
      quantity: Math.abs(movement.delta),
      sourceLocationId: movement.delta < 0 ? locationId : null,
      destinationLocationId: movement.delta > 0 ? locationId : null,
      referenceType: "PRODUCT_IMPORT",
      referenceId: null,
      reason: "Import Excel produits",
      note: adjustmentNote(movement.before, movement.after, movement.delta),
      createdByUserId: userId,
      status: "VALIDATED" as const,
    })),
  });
  pending.length = 0;
}

async function syncStock(
  tx: Db,
  organizationId: string,
  userId: string,
  locationId: string,
  productId: string,
  targetStock: number,
  sequences: ImportSequences,
  pending: PendingMovement[] | null = null,
): Promise<boolean> {
  const level = await tx.stockLevel.upsert({
    where: { productId_locationId: { productId, locationId } },
    update: {},
    create: { organizationId, productId, locationId, quantity: 0, reservedQuantity: 0 },
    select: { id: true, quantity: true },
  });

  const delta = targetStock - level.quantity;
  if (delta === 0) return false;

  await tx.stockLevel.update({
    where: { id: level.id },
    data: { quantity: targetStock },
  });

  // Group transaction: the movement is recorded by commitMovements (one number reservation, one insert).
  if (pending) {
    pending.push({ productId, delta, before: level.quantity, after: targetStock });
    return true;
  }

  await tx.stockMovement.create({
    data: {
      organizationId,
      movementNumber: await sequences.nextMovementNumber(tx, organizationId),
      type: "INVENTORY_ADJUSTMENT",
      productId,
      quantity: Math.abs(delta),
      sourceLocationId: delta < 0 ? locationId : null,
      destinationLocationId: delta > 0 ? locationId : null,
      referenceType: "PRODUCT_IMPORT",
      referenceId: null,
      reason: "Import Excel produits",
      // Same "ADJUSTMENT_SNAPSHOT:{...}" note shape as
      // stock-movements.ts#buildAdjustmentNote, so /stock's movement table
      // renders the before/after for import movements too.
      note: `ADJUSTMENT_SNAPSHOT:${JSON.stringify({
        beforeQuantity: level.quantity,
        afterQuantity: targetStock,
        deltaQuantity: delta,
      })}`,
      createdByUserId: userId,
      status: "VALIDATED",
    },
  });

  return true;
}
