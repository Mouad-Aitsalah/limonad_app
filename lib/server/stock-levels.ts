import "server-only";

import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { StockLevelDto, StockSummaryDto } from "@/types/operations-dto";

const stockLevelInclude = {
  product: {
    select: {
      id: true,
      reference: true,
      barcode: true,
      name: true,
      minimumStock: true,
      salePrice: true,
      categoryId: true,
      category: { select: { name: true } },
      brandId: true,
      brand: { select: { name: true } },
      defaultSupplierId: true,
      defaultSupplier: { select: { name: true } },
    },
  },
  location: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      depotId: true,
      truckId: true,
    },
  },
};

type StockLevelRecord = Awaited<ReturnType<typeof getStockLevelRecord>>;

export function mapStockLevelToDto(level: NonNullable<StockLevelRecord>): StockLevelDto {
  const availableQuantity = level.quantity - level.reservedQuantity;
  const status =
    availableQuantity === 0
      ? "OUT_OF_STOCK"
      : availableQuantity <= level.product.minimumStock
        ? "LOW_STOCK"
        : "AVAILABLE";
  const salePrice = level.product.salePrice.toNumber();

  return {
    id: level.id,
    productId: level.productId,
    productReference: level.product.reference,
    productName: level.product.name,
    barcode: level.product.barcode,
    categoryId: level.product.categoryId,
    categoryName: level.product.category.name,
    brandId: level.product.brandId,
    brandName: level.product.brand?.name ?? null,
    supplierId: level.product.defaultSupplierId,
    supplierName: level.product.defaultSupplier?.name ?? null,
    locationId: level.locationId,
    locationCode: level.location.code,
    locationName: level.location.name,
    locationType: level.location.type,
    quantity: level.quantity,
    reservedQuantity: level.reservedQuantity,
    availableQuantity,
    minimumStock: level.product.minimumStock,
    salePrice,
    stockValue: salePrice * level.quantity,
    status,
    updatedAt: level.updatedAt.toISOString(),
  };
}

export async function getStockLevels(): Promise<StockLevelDto[]> {
  const currentUser = await requireOrganizationUser();
  const levels = await prisma.stockLevel.findMany({
    where: { organizationId: currentUser.organizationId },
    include: stockLevelInclude,
    orderBy: [{ location: { code: "asc" } }, { product: { name: "asc" } }],
  });
  return levels.map(mapStockLevelToDto);
}

export async function getStockLevelsByLocation(locationId: string): Promise<StockLevelDto[]> {
  const currentUser = await requireOrganizationUser();
  const levels = await prisma.stockLevel.findMany({
    where: { locationId, organizationId: currentUser.organizationId },
    include: stockLevelInclude,
    orderBy: { product: { name: "asc" } },
  });
  return levels.map(mapStockLevelToDto);
}

export async function getStockLevelsByProduct(productId: string): Promise<StockLevelDto[]> {
  const currentUser = await requireOrganizationUser();
  const levels = await prisma.stockLevel.findMany({
    where: { productId, organizationId: currentUser.organizationId },
    include: stockLevelInclude,
    orderBy: { location: { code: "asc" } },
  });
  return levels.map(mapStockLevelToDto);
}

export async function getDepotStock(depotId: string): Promise<StockLevelDto[]> {
  const currentUser = await requireOrganizationUser();
  const location = await prisma.stockLocation.findFirst({
    where: { depotId, organizationId: currentUser.organizationId },
  });
  if (!location) throw new OperationsServiceError("Emplacement depot introuvable.", 404);
  return getStockLevelsByLocation(location.id);
}

export async function getTruckStock(truckId: string): Promise<StockLevelDto[]> {
  const currentUser = await requireOrganizationUser();
  const location = await prisma.stockLocation.findFirst({
    where: { truckId, organizationId: currentUser.organizationId },
  });
  if (!location) throw new OperationsServiceError("Emplacement camion introuvable.", 404);
  return getStockLevelsByLocation(location.id);
}

export async function getStockLevel(
  productId: string,
  locationId: string,
): Promise<StockLevelDto> {
  const currentUser = await requireOrganizationUser();
  const level = await getStockLevelRecord(productId, locationId, currentUser.organizationId);
  if (!level) throw new OperationsServiceError("Niveau de stock introuvable.", 404);
  return mapStockLevelToDto(level);
}

export async function getStockSummary(): Promise<StockSummaryDto> {
  const levels = await getStockLevels();

  return {
    totalValue: levels.reduce((sum, level) => sum + level.stockValue, 0),
    productCount: new Set(levels.map((level) => level.productId)).size,
    outOfStockCount: levels.filter((level) => level.status === "OUT_OF_STOCK").length,
    lowStockCount: levels.filter((level) => level.status === "LOW_STOCK").length,
    trucksValue: levels
      .filter((level) => level.locationType === "TRUCK")
      .reduce((sum, level) => sum + level.stockValue, 0),
  };
}

async function getStockLevelRecord(
  productId: string,
  locationId: string,
  organizationId: string,
) {
  return prisma.stockLevel.findFirst({
    where: { productId, locationId, organizationId },
    include: stockLevelInclude,
  });
}
