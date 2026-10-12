import { Prisma } from "@/lib/generated/prisma/client";
import { isPortablePhotoUrl, checkPhotoDataUrl, photoDataUrl } from "@/lib/import-export/images";
import type { ProductExportRow, ProductStatusCode } from "@/lib/import-export/products-format";
import { computePriceTTC } from "@/lib/product-pricing";

/**
 * The database side of the products export and of the photo import, for ONE
 * organisation already authorised by the caller (lib/server/products-export.ts:
 * admin only; lib/server/products-photos.ts: the import roles). The client is
 * injected so the tests run it in a rolled-back transaction.
 *
 * The export returns BUSINESS values only - never an internal id, never the
 * organisation: a product is identified by its reference, a category / brand by
 * its name, a supplier by its code (+ name). Prices are given TTC (the file's
 * convention) from the stored HT with computePriceTTC; the import turns them
 * back into exactly the same HT.
 */

type Db = Prisma.TransactionClient;

export const PRODUCT_EXPORT_PAGE_SIZE = 500;

/** The /produits filters, with the same meaning as the page (getProductsPage). */
export type ProductExportFilters = {
  search?: string;
  categoryId?: string;
  /** "ACTIVE" | "INACTIVE"; anything else = every status. */
  status?: string;
};

function exportWhere(organizationId: string, filters: ProductExportFilters): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { organizationId };
  if (filters.categoryId && filters.categoryId !== "all") where.categoryId = filters.categoryId;
  if (filters.status === "ACTIVE" || filters.status === "INACTIVE") where.status = filters.status;
  const search = filters.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { reference: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search, mode: "insensitive" } },
    ];
  }
  return where;
}

/**
 * One page of the export, ordered by reference (unique in the organisation), the
 * cursor being the last reference of the previous page. `depotLocationId` = the
 * exporting user's depot StockLocation when the stock column was asked for (the
 * import's QuantiteStock semantics: that depot's stock, never depots + trucks).
 */
export async function loadProductsExportPage(
  db: Db,
  organizationId: string,
  options: { filters: ProductExportFilters; cursor: string | null; pageSize?: number; depotLocationId: string | null },
): Promise<{ rows: ProductExportRow[]; nextCursor: string | null; total: number | null }> {
  const pageSize = Math.min(Math.max(1, options.pageSize ?? PRODUCT_EXPORT_PAGE_SIZE), PRODUCT_EXPORT_PAGE_SIZE);
  const where = exportWhere(organizationId, options.filters);
  const [products, total] = await Promise.all([
    db.product.findMany({
      where: options.cursor ? { AND: [where, { reference: { gt: options.cursor } }] } : where,
      orderBy: { reference: "asc" },
      take: pageSize + 1,
      select: {
        id: true,
        reference: true,
        name: true,
        category: { select: { name: true } },
        defaultSupplier: { select: { code: true, name: true } },
        brand: { select: { name: true } },
        purchasePrice: true,
        salePrice: true,
        retailPrice: true,
        semiWholesalePrice: true,
        semiWholesaleMinQty: true,
        wholesaleMinQty: true,
        taxRate: true,
        unit: true,
        barcode: true,
        description: true,
        minimumStock: true,
        status: true,
      },
    }),
    options.cursor ? Promise.resolve(null) : db.product.count({ where }),
  ]);
  const page = products.slice(0, pageSize);
  const ids = page.map((product) => product.id);

  const [levels, photos] = await Promise.all([
    options.depotLocationId && ids.length
      ? db.stockLevel.findMany({
          where: { organizationId, locationId: options.depotLocationId, productId: { in: ids } },
          select: { productId: true, quantity: true },
        })
      : Promise.resolve([]),
    // The KIND of photo only (never the image bytes here): "stored" for a data: URI, the URL for an external one.
    ids.length
      ? db.$queryRaw<Array<{ id: string; kind: string | null; url: string | null }>>(Prisma.sql`
          SELECT id,
                 CASE WHEN "imageUrl" LIKE 'data:%' THEN 'stored'
                      WHEN "imageUrl" ~* '^https?://' THEN 'url'
                      ELSE NULL END AS kind,
                 CASE WHEN "imageUrl" ~* '^https?://' THEN "imageUrl" ELSE NULL END AS url
          FROM "Product"
          WHERE "organizationId" = ${organizationId} AND id = ANY(${ids})
        `)
      : Promise.resolve([]),
  ]);
  const stockById = new Map(levels.map((level) => [level.productId, level.quantity]));
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));

  const rows: ProductExportRow[] = page.map((product) => {
    const taxRate = product.taxRate.toNumber();
    const ttc = (ht: Prisma.Decimal | null) => (ht === null ? null : computePriceTTC(ht.toNumber(), taxRate));
    const photo = photoById.get(product.id);
    return {
      reference: product.reference,
      name: product.name,
      categoryName: product.category?.name ?? null,
      supplierCode: product.defaultSupplier?.code ?? null,
      supplierName: product.defaultSupplier?.name ?? null,
      purchasePriceTTC: computePriceTTC(product.purchasePrice.toNumber(), taxRate),
      salePriceTTC: computePriceTTC(product.salePrice.toNumber(), taxRate),
      retailPriceTTC: ttc(product.retailPrice),
      semiWholesalePriceTTC: ttc(product.semiWholesalePrice),
      semiWholesaleMinQty: product.semiWholesaleMinQty,
      wholesaleMinQty: product.wholesaleMinQty,
      taxRate,
      unit: product.unit,
      barcode: product.barcode,
      brandName: product.brand?.name ?? null,
      description: product.description,
      minimumStock: product.minimumStock,
      status: product.status as ProductStatusCode,
      depotStock: options.depotLocationId ? (stockById.get(product.id) ?? 0) : null,
      photo:
        photo?.kind === "stored"
          ? { kind: "stored" }
          : photo?.kind === "url" && photo.url && isPortablePhotoUrl(photo.url)
            ? { kind: "url", url: photo.url }
            : null,
    };
  });

  return { rows, nextCursor: products.length > pageSize ? page[page.length - 1].reference : null, total };
}

/** Largest amount of photo data (data: URI characters) in one answer - well under a Vercel response. */
export const PHOTO_EXPORT_BUDGET_CHARS = 3_000_000;
/** A single stored photo larger than this is reported instead of sent. */
const PHOTO_EXPORT_SINGLE_MAX_CHARS = 4_000_000;

/**
 * The stored photos of some references, in small answers: photos are added in
 * the order asked until the budget is reached, the rest comes back in
 * `remaining` for the next call. Only data: photos of this organisation.
 */
export async function loadProductExportPhotos(
  db: Db,
  organizationId: string,
  references: string[],
): Promise<{ photos: Array<{ reference: string; dataUrl: string }>; remaining: string[]; skipped: Array<{ reference: string; reason: string }> }> {
  const unique = [...new Set(references)];
  if (unique.length === 0) return { photos: [], remaining: [], skipped: [] };
  const sizes = await db.$queryRaw<Array<{ reference: string; size: number | null }>>(Prisma.sql`
    SELECT reference, length("imageUrl")::int AS size
    FROM "Product"
    WHERE "organizationId" = ${organizationId} AND reference = ANY(${unique}) AND "imageUrl" LIKE 'data:%'
  `);
  const sizeByReference = new Map(sizes.map((row) => [row.reference, row.size ?? 0]));
  const take: string[] = [];
  const remaining: string[] = [];
  const skipped: Array<{ reference: string; reason: string }> = [];
  let used = 0;
  for (const reference of unique) {
    const size = sizeByReference.get(reference);
    if (size === undefined) {
      skipped.push({ reference, reason: "Aucune photo enregistrée." });
      continue;
    }
    if (size > PHOTO_EXPORT_SINGLE_MAX_CHARS) {
      skipped.push({ reference, reason: "Photo enregistrée trop volumineuse pour l'export." });
      continue;
    }
    if (take.length > 0 && used + size > PHOTO_EXPORT_BUDGET_CHARS) {
      remaining.push(reference);
      continue;
    }
    take.push(reference);
    used += size;
  }
  const rows = take.length
    ? await db.product.findMany({ where: { organizationId, reference: { in: take } }, select: { reference: true, imageUrl: true } })
    : [];
  const byReference = new Map(rows.map((row) => [row.reference, row.imageUrl]));
  const photos: Array<{ reference: string; dataUrl: string }> = [];
  for (const reference of take) {
    const dataUrl = byReference.get(reference);
    if (dataUrl) photos.push({ reference, dataUrl });
  }
  return { photos, remaining, skipped };
}

export type PhotoImportResult = {
  reference: string;
  status: "UPDATED" | "UNCHANGED" | "NOT_FOUND" | "INVALID";
  message: string;
};

/**
 * Saves imported photos (from the ZIP, prepared in the browser) on the products
 * of THIS organisation, matched by reference. Each image is re-checked from its
 * content (PNG / JPEG / WebP / GIF, 2 MB max) and stored in the app's format (a
 * data: URI with the real MIME type), exactly like a photo uploaded in the
 * product form.
 */
export async function applyProductPhotos(
  db: Db,
  organizationId: string,
  items: Array<{ reference: string; dataUrl: string }>,
): Promise<PhotoImportResult[]> {
  const results: PhotoImportResult[] = [];
  const references = [...new Set(items.map((item) => item.reference))];
  const existing = references.length
    ? await db.product.findMany({ where: { organizationId, reference: { in: references } }, select: { id: true, reference: true } })
    : [];
  const idByReference = new Map(existing.map((product) => [product.reference, product.id]));
  for (const item of items) {
    const check = checkPhotoDataUrl(item.dataUrl);
    if (!check.ok) {
      results.push({ reference: item.reference, status: "INVALID", message: check.message });
      continue;
    }
    const id = idByReference.get(item.reference);
    if (!id) {
      results.push({ reference: item.reference, status: "NOT_FOUND", message: "Produit introuvable dans cette organisation." });
      continue;
    }
    const imageUrl = photoDataUrl(check.bytes, check.mime);
    const { count } = await db.product.updateMany({
      // "different from the new photo" - including NO photo yet (NULL never compares equal in SQL)
      where: { id, organizationId, OR: [{ imageUrl: null }, { NOT: { imageUrl } }] },
      data: { imageUrl },
    });
    results.push(
      count > 0
        ? { reference: item.reference, status: "UPDATED", message: "Photo enregistrée." }
        : { reference: item.reference, status: "UNCHANGED", message: "Photo identique déjà enregistrée." },
    );
  }
  return results;
}
