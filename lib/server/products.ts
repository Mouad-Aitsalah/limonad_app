import "server-only";

import { z } from "zod";

import { MONEY_RANGE_MAX_NUMBER } from "@/lib/money";
import { computePriceTTC } from "@/lib/product-pricing";
import { prisma } from "@/lib/prisma";
import { assertMoneyRange, OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { DriverPosProductDto } from "@/types/operations-dto";
import type {
  ProductDto,
  ProductMutationInput,
  ProductOptionDto,
  ProductsPageDto,
} from "@/types/product-dto";

type ProductRecord = Awaited<ReturnType<typeof getProductRecordById>>;

const productInclude = {
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  defaultSupplier: { select: { id: true, name: true } },
};

const optionalNullableString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

export const productMutationSchema = z.object({
  reference: z.string().trim().min(1, "La reference est obligatoire."),
  barcode: optionalNullableString,
  name: z.string().trim().min(1, "La designation est obligatoire."),
  description: optionalNullableString,
  categoryId: z.string().trim().min(1, "La categorie est obligatoire."),
  brandId: optionalNullableString,
  defaultSupplierId: optionalNullableString,
  // F8-F: input-level sanity bound only (Decimal(12,2)), not the real
  // protection - a second, server-side assertMoneyRange call in
  // parseAndValidateProductInput below is the actual gate, since this
  // schema might not be the only caller in the future (see F8-D's own
  // documentation of the same split).
  purchasePrice: z.coerce
    .number()
    .min(0, "Le prix d'achat doit etre superieur ou egal a 0.")
    .max(MONEY_RANGE_MAX_NUMBER, "Le prix d'achat depasse la limite autorisee."),
  salePrice: z.coerce
    .number()
    .min(0, "Le prix de vente doit etre superieur ou egal a 0.")
    .max(MONEY_RANGE_MAX_NUMBER, "Le prix de vente depasse la limite autorisee."),
  taxRate: z.coerce.number().min(0, "La TVA doit etre superieure ou egale a 0."),
  unit: z.string().trim().min(1, "L'unite est obligatoire."),
  minimumStock: z.coerce
    .number()
    .int("Le stock minimum doit etre un nombre entier.")
    .min(0, "Le stock minimum doit etre superieur ou egal a 0."),
  imageUrl: optionalNullableString,
});

export class ProductServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export function mapProductToDto(product: NonNullable<ProductRecord>): ProductDto {
  return {
    id: product.id,
    reference: product.reference,
    barcode: product.barcode,
    name: product.name,
    description: product.description,
    purchasePrice: product.purchasePrice.toNumber(),
    salePrice: product.salePrice.toNumber(),
    taxRate: product.taxRate.toNumber(),
    unit: product.unit,
    minimumStock: product.minimumStock,
    status: product.status,
    imageUrl: product.imageUrl,
    category: product.category,
    brand: product.brand,
    supplier: product.defaultSupplier,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export async function getProducts(): Promise<ProductDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const products = await prisma.product.findMany({
    where: { organizationId: currentUser.organizationId },
    include: productInclude,
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });

  return products.map(mapProductToDto);
}

const PRODUCTS_DEFAULT_PAGE_SIZE = 25;
const PRODUCTS_MAX_PAGE_SIZE = 100;

export type ProductsPageParams = {
  cursor?: string | null;
  pageSize?: number;
  categoryId?: string;
  brandId?: string;
  /** "ACTIVE" | "INACTIVE" - any other value (including "all"/undefined)
   * means "every status", matching the /produits toolbar's "disponibilite"
   * filter (disponible -> ACTIVE, indisponible -> anything else). */
  status?: string;
  /** name / reference / barcode - same fields the old, fully-client-side
   * ProductsView search used to match against. */
  search?: string;
};

function clampProductsPageSize(pageSize: number | undefined): number {
  const requested = Math.trunc(pageSize ?? PRODUCTS_DEFAULT_PAGE_SIZE);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, PRODUCTS_MAX_PAGE_SIZE)
    : PRODUCTS_DEFAULT_PAGE_SIZE;
}

function buildProductsWhere(
  organizationId: string,
  params: ProductsPageParams,
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { organizationId };

  if (params.categoryId) where.categoryId = params.categoryId;
  if (params.brandId) where.brandId = params.brandId;
  if (params.status) where.status = params.status as Prisma.ProductWhereInput["status"];
  const search = params.search?.trim();
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
 * Phase 3 adversarial audit finding CRITICAL #1: getProducts() above is
 * fully unbounded (no take at all) - measured 12.5s / 56MB at 100k products.
 * It used to be relied on directly by 6 client-side product pickers (avoirs
 * x2, chargements x2, inventaire, stock x2, achats - the audit's original
 * "5 pages" count missed achats/purchase-form.tsx, which reaches it via a
 * client fetch("/api/products") rather than a direct import, invisible to a
 * static grep for the function name). Every one of those now uses
 * getProductPickerPreload() (a small bounded preload) + searchProducts()/
 * GET /api/products/search (server-side search on demand) instead - see
 * that chantier's report. getProducts() itself is kept, unchanged, only
 * because GET /api/products/route.ts still exposes it as a raw endpoint
 * with no other known caller left - removing the endpoint entirely was
 * judged out of scope for a chantier about fixing pickers, not deleting
 * routes.
 *
 * /produits (the actual admin catalog list) gets this new, dedicated,
 * cursor-paginated + server-filtered function instead - same
 * `productInclude` as getProducts() (already light: single-level category/
 * brand/supplier selects, no nested arrays), same
 * `createdAt desc, id desc` stable-sort convention as every other Phase 3
 * list (replacing the old `[{updatedAt:"desc"},{name:"asc"}]` order, which
 * doesn't compose with cursor pagination the way a monotonic id tiebreak
 * does).
 */
export async function getProductsPage(params: ProductsPageParams = {}): Promise<ProductsPageDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = currentUser.organizationId;
  const pageSize = clampProductsPageSize(params.pageSize);
  const where = buildProductsWhere(organizationId, params);

  const [rows, totalCount] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    prisma.product.count({ where }),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    items: pageRows.map(mapProductToDto),
    nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    hasMore,
    totalCount,
  };
}

export async function getProductById(id: string): Promise<ProductDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const product = await getProductRecordById(id, currentUser.organizationId);
  if (!product) {
    throw new ProductServiceError("Produit introuvable.", 404);
  }
  return mapProductToDto(product);
}

export async function createProduct(input: ProductMutationInput): Promise<ProductDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const data = await parseAndValidateProductInput(currentUser.organizationId, input);

  try {
    const product = await prisma.product.create({
      data: {
        organizationId: currentUser.organizationId,
        reference: data.reference,
        barcode: data.barcode,
        name: data.name,
        description: data.description,
        categoryId: data.categoryId,
        brandId: data.brandId,
        defaultSupplierId: data.defaultSupplierId,
        purchasePrice: data.purchasePrice,
        salePrice: data.salePrice,
        taxRate: data.taxRate,
        unit: data.unit,
        minimumStock: data.minimumStock,
        imageUrl: data.imageUrl,
        status: "ACTIVE",
      },
      include: productInclude,
    });

    return mapProductToDto(product);
  } catch (error) {
    throw mapPrismaProductError(error);
  }
}

export async function updateProduct(
  id: string,
  input: ProductMutationInput,
): Promise<ProductDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getProductRecordById(id, currentUser.organizationId);
  if (!existing) {
    throw new ProductServiceError("Produit introuvable.", 404);
  }
  const data = await parseAndValidateProductInput(currentUser.organizationId, input, id);

  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        reference: data.reference,
        barcode: data.barcode,
        name: data.name,
        description: data.description,
        categoryId: data.categoryId,
        brandId: data.brandId,
        defaultSupplierId: data.defaultSupplierId,
        purchasePrice: data.purchasePrice,
        salePrice: data.salePrice,
        taxRate: data.taxRate,
        unit: data.unit,
        minimumStock: data.minimumStock,
        imageUrl: data.imageUrl,
      },
      include: productInclude,
    });

    return mapProductToDto(product);
  } catch (error) {
    throw mapPrismaProductError(error);
  }
}

export async function setProductStatus(
  id: string,
  active: boolean,
): Promise<ProductDto> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const existing = await getProductRecordById(id, currentUser.organizationId);
  if (!existing) {
    throw new ProductServiceError("Produit introuvable.", 404);
  }

  try {
    const product = await prisma.product.update({
      where: { id },
      data: { status: active ? "ACTIVE" : "INACTIVE" },
      include: productInclude,
    });

    return mapProductToDto(product);
  } catch (error) {
    throw mapPrismaProductError(error);
  }
}

export async function getCategories(): Promise<ProductOptionDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  return prisma.category.findMany({
    where: { active: true, organizationId: currentUser.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getBrands(): Promise<ProductOptionDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  return prisma.brand.findMany({
    where: { active: true, organizationId: currentUser.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getSuppliers(): Promise<ProductOptionDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  return prisma.supplier.findMany({
    where: { active: true, organizationId: currentUser.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

const PRODUCT_SEARCH_DEFAULT_LIMIT = 20;
const PRODUCT_SEARCH_MAX_LIMIT = 50;

/**
 * Phase 3 section 6: dedicated fast-path product search for POS (comptoir +
 * chauffeur), evaluated per the chantier spec. Today's POS product list is
 * NOT the raw 10k+ catalog: getCounterPosContext()/getDriverPosContext()
 * already scope it to whatever has stock at the current depot/truck (see
 * the Phase 3 report), so the "load everything then filter in React"
 * anti-pattern the spec warns about isn't actually what POS does today.
 * This endpoint exists as fast, additive, ready-to-use infrastructure for
 * whenever that changes (e.g. a future "search the full catalog, not just
 * what's in stock here" POS feature) - see the report for the measured
 * evidence behind leaving today's POS data flow untouched instead of
 * wiring this in immediately. An exact barcode match is checked first
 * (a scan should never be shadowed by a partial name/reference match), then
 * name/reference/barcode substring search.
 */
/**
 * The supplier-avoir picker's one real business rule (previously enforced
 * client-side in supplier-credit-note-pos-view.tsx over the full catalog):
 * scope to that supplier's own products, but only when the supplier
 * genuinely has at least one - an org whose supplier has zero products
 * assigned falls back to the unrestricted catalog rather than showing an
 * always-empty picker. The existence check is a single indexed findFirst
 * (Product_defaultSupplierId_idx already exists), so this costs one cheap
 * extra round trip only when supplierId is actually passed in.
 */
async function resolveSupplierFilter(
  organizationId: string,
  supplierId: string | undefined,
  activeFilter: Prisma.ProductWhereInput,
): Promise<Prisma.ProductWhereInput> {
  if (!supplierId) return {};
  const supplierHasProducts = await prisma.product.findFirst({
    where: { organizationId, defaultSupplierId: supplierId, ...activeFilter },
    select: { id: true },
  });
  return supplierHasProducts ? { defaultSupplierId: supplierId } : {};
}

export async function searchProducts(params: {
  q: string;
  limit?: number;
  activeOnly?: boolean;
  /** See resolveSupplierFilter's doc comment - only the supplier-avoir picker passes this. */
  supplierId?: string;
}): Promise<ProductDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier", "driver"]);
  const organizationId = currentUser.organizationId;
  const query = params.q.trim();
  if (!query) return [];

  const requestedLimit = Math.trunc(params.limit ?? PRODUCT_SEARCH_DEFAULT_LIMIT);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, PRODUCT_SEARCH_MAX_LIMIT)
      : PRODUCT_SEARCH_DEFAULT_LIMIT;
  const activeFilter: Prisma.ProductWhereInput = params.activeOnly !== false ? { status: "ACTIVE" } : {};
  const supplierFilter = await resolveSupplierFilter(organizationId, params.supplierId, activeFilter);

  const exactBarcodeMatch = await prisma.product.findFirst({
    where: { organizationId, barcode: query, ...activeFilter, ...supplierFilter },
    include: productInclude,
  });
  if (exactBarcodeMatch) {
    return [mapProductToDto(exactBarcodeMatch)];
  }

  const matches = await prisma.product.findMany({
    where: {
      organizationId,
      ...activeFilter,
      ...supplierFilter,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { reference: { contains: query, mode: "insensitive" } },
        { barcode: { contains: query, mode: "insensitive" } },
      ],
    },
    include: productInclude,
    orderBy: { name: "asc" },
    take: limit,
  });

  return matches.map(mapProductToDto);
}

const PRODUCT_PICKER_PRELOAD_LIMIT = 20;

/**
 * Phase 3 CRITICAL #1 fix: the small, bounded "something to browse before
 * you type" list for every product picker that used to receive the entire
 * getProducts() catalog (avoirs, chargements, inventaire, stock, achats -
 * see getProducts()'s own doc comment). Same shape/ordering as getProducts()
 * (productInclude, updatedAt desc then name asc) so swapping the caller is a
 * pure data-source change, not a UI rewrite. Anything beyond this bounded
 * set is reached through searchProducts()/GET /api/products/search, exactly
 * like the POS product/customer pickers already do.
 */
export async function getProductPickerPreload(params?: {
  limit?: number;
  supplierId?: string;
}): Promise<ProductDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organizationId = currentUser.organizationId;
  const requestedLimit = Math.trunc(params?.limit ?? PRODUCT_PICKER_PRELOAD_LIMIT);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, PRODUCT_SEARCH_MAX_LIMIT)
      : PRODUCT_PICKER_PRELOAD_LIMIT;
  const activeFilter: Prisma.ProductWhereInput = { status: "ACTIVE" };
  const supplierFilter = await resolveSupplierFilter(organizationId, params?.supplierId, activeFilter);

  const products = await prisma.product.findMany({
    where: { organizationId, ...activeFilter, ...supplierFilter },
    include: productInclude,
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    take: limit,
  });

  return products.map(mapProductToDto);
}

/**
 * Phase 3 follow-up: location-scoped POS search, the fallback the frontend
 * calls when a POS context's `products` list was truncated (see
 * POS_PRODUCT_LIST_LIMIT in counter-sales.ts/driver-sales.ts) and the
 * cashier/driver has typed a query - lets them still find and sell an item
 * beyond the preload cap instead of it being silently unreachable. Scoped to
 * `quantity > 0` at the given location, same shape as the preloaded list
 * (DriverPosProductDto) so the frontend can merge results in directly.
 */
export async function searchPosProducts(params: {
  locationId: string;
  q: string;
  limit?: number;
}): Promise<DriverPosProductDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier", "driver"]);
  const organizationId = currentUser.organizationId;
  const query = params.q.trim();
  if (!query) return [];

  const requestedLimit = Math.trunc(params.limit ?? PRODUCT_SEARCH_DEFAULT_LIMIT);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, PRODUCT_SEARCH_MAX_LIMIT)
      : PRODUCT_SEARCH_DEFAULT_LIMIT;

  const levelSelect = {
    product: {
      select: {
        id: true,
        reference: true,
        barcode: true,
        name: true,
        imageUrl: true,
        salePrice: true,
        taxRate: true,
      },
    },
  } as const;

  function toDto(level: {
    quantity: number;
    reservedQuantity: number;
    product: {
      id: string;
      reference: string;
      barcode: string | null;
      name: string;
      imageUrl: string | null;
      salePrice: Prisma.Decimal;
      taxRate: Prisma.Decimal;
    };
  }): DriverPosProductDto {
    const salePriceHT = level.product.salePrice.toNumber();
    const taxRate = level.product.taxRate.toNumber();
    return {
      id: level.product.id,
      reference: level.product.reference,
      barcode: level.product.barcode,
      name: level.product.name,
      imageUrl: level.product.imageUrl,
      salePriceHT,
      salePriceTTC: computePriceTTC(salePriceHT, taxRate),
      taxRate,
      availableQuantity: level.quantity - level.reservedQuantity,
    };
  }

  const exactBarcodeMatch = await prisma.stockLevel.findFirst({
    where: {
      organizationId,
      locationId: params.locationId,
      quantity: { gt: 0 },
      product: { status: "ACTIVE", barcode: query },
    },
    select: { quantity: true, reservedQuantity: true, ...levelSelect },
  });
  if (exactBarcodeMatch) {
    return [toDto(exactBarcodeMatch)];
  }

  const matches = await prisma.stockLevel.findMany({
    where: {
      organizationId,
      locationId: params.locationId,
      quantity: { gt: 0 },
      product: {
        status: "ACTIVE",
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { reference: { contains: query, mode: "insensitive" } },
          { barcode: { contains: query, mode: "insensitive" } },
        ],
      },
    },
    select: { quantity: true, reservedQuantity: true, ...levelSelect },
    orderBy: { product: { name: "asc" } },
    take: limit,
  });

  return matches.map(toDto);
}

async function getProductRecordById(id: string, organizationId: string) {
  return prisma.product.findFirst({
    where: { id, organizationId },
    include: productInclude,
  });
}

async function parseAndValidateProductInput(
  organizationId: string,
  input: ProductMutationInput,
  currentProductId?: string,
) {
  const parsed = productMutationSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProductServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "form",
          issue.message,
        ]),
      ),
    );
  }

  const data = parsed.data;

  // F8-F: server-side gate, kept independent of the Zod .max() above - this
  // is the single choke point both createProduct and updateProduct funnel
  // through, so it protects both create and update with one check. Reuses
  // lib/money.ts's Decimal-based comparison via assertMoneyRange
  // (lib/server/depots.ts), adapted to this file's own ProductServiceError
  // convention since this route only ever catches that class.
  assertProductMoneyRange(data.purchasePrice, "purchasePrice");
  assertProductMoneyRange(data.salePrice, "salePrice");

  const [referenceOwner, barcodeOwner, category, brand, supplier] =
    await prisma.$transaction([
      prisma.product.findFirst({
        where: { reference: data.reference, organizationId },
        select: { id: true },
      }),
      data.barcode
        ? prisma.product.findFirst({
            where: { barcode: data.barcode, organizationId },
            select: { id: true },
          })
        : prisma.product.findFirst({
            where: { id: "__never__" },
            select: { id: true },
          }),
      prisma.category.findFirst({
        where: { id: data.categoryId, organizationId },
        select: { id: true },
      }),
      data.brandId
        ? prisma.brand.findFirst({
            where: { id: data.brandId, organizationId },
            select: { id: true },
          })
        : prisma.brand.findFirst({
            where: { id: "__never__" },
            select: { id: true },
          }),
      data.defaultSupplierId
        ? prisma.supplier.findFirst({
            where: { id: data.defaultSupplierId, organizationId },
            select: { id: true },
          })
        : prisma.supplier.findFirst({
            where: { id: "__never__" },
            select: { id: true },
          }),
    ]);

  const fieldErrors: Record<string, string> = {};
  if (referenceOwner && referenceOwner.id !== currentProductId) {
    fieldErrors.reference = "Cette reference existe deja.";
  }
  if (barcodeOwner && barcodeOwner.id !== currentProductId) {
    fieldErrors.barcode = "Ce code-barres existe deja.";
  }
  if (!category) {
    fieldErrors.categoryId = "Categorie inexistante.";
  }
  if (data.brandId && !brand) {
    fieldErrors.brandId = "Marque inexistante.";
  }
  if (data.defaultSupplierId && !supplier) {
    fieldErrors.defaultSupplierId = "Fournisseur inexistant.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new ProductServiceError("Certains champs sont invalides.", 422, fieldErrors);
  }

  return data;
}

// F8-F: adapts the shared assertMoneyRange (which throws
// OperationsServiceError) to this file's own ProductServiceError - the
// product API routes only ever catch ProductServiceError (see
// app/api/products/route.ts and [id]/route.ts), so a bare
// OperationsServiceError here would fall through to their generic 500
// fallback instead of the intended 422. No new range-checking logic is
// introduced - this only re-throws the same message/status.
function assertProductMoneyRange(value: number, label: string) {
  try {
    assertMoneyRange(value, label);
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      throw new ProductServiceError(error.message, error.status);
    }
    throw error;
  }
}

function mapPrismaProductError(error: unknown) {
  const prismaError = error as { code?: string; meta?: { target?: string[] } };

  if (prismaError.code === "P2025") {
    return new ProductServiceError("Produit introuvable.", 404);
  }

  if (prismaError.code === "P2002") {
    const target = prismaError.meta?.target ?? [];
    if (target.includes("reference")) {
      return new ProductServiceError("Cette reference existe deja.", 409, {
        reference: "Cette reference existe deja.",
      });
    }
    if (target.includes("barcode")) {
      return new ProductServiceError("Ce code-barres existe deja.", 409, {
        barcode: "Ce code-barres existe deja.",
      });
    }
  }

  if (prismaError.code === "P2003") {
    return new ProductServiceError("Une relation selectionnee est introuvable.", 422);
  }

  return new ProductServiceError("Une erreur est survenue pendant l'operation.", 500);
}
