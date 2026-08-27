import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { ProductDto, ProductMutationInput, ProductOptionDto } from "@/types/product-dto";

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
  purchasePrice: z.coerce
    .number()
    .min(0, "Le prix d'achat doit etre superieur ou egal a 0."),
  salePrice: z.coerce
    .number()
    .min(0, "Le prix de vente doit etre superieur ou egal a 0."),
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
