import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { InventoryGetPayload } from "@/lib/generated/prisma/models/Inventory";
import { requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { nextMovementNumber } from "@/lib/server/sales-shared";
import type { UserRole } from "@/types/auth";
import type {
  InventoryCreateInput,
  InventoryDto,
  InventoryLineDto,
  InventoryLineSaveInput,
  InventorySummaryDto,
} from "@/types/operations-dto";

const managerRoles: UserRole[] = ["admin", "depot_manager"];

const inventoryLineInclude = {
  product: {
    select: { id: true, reference: true, name: true, barcode: true, unit: true },
  },
} as const;

const inventoryInclude = {
  depot: { select: { id: true, name: true } },
  createdBy: { select: { fullName: true } },
  lines: {
    include: inventoryLineInclude,
    orderBy: { createdAt: "asc" },
  },
} as const;

type InventoryWithRelations = InventoryGetPayload<{ include: typeof inventoryInclude }>;
type InventoryLineWithRelations = InventoryWithRelations["lines"][number];

export type InventoryTotalsDto = {
  linesCount: number;
  totalValue: number;
  totalStockBefore: number;
  totalDifference: number;
};

function computeTotals(lines: InventoryLineWithRelations[]): InventoryTotalsDto {
  return lines.reduce(
    (totals, line) => {
      totals.linesCount += 1;
      totals.totalValue = roundMoney(totals.totalValue + line.lineValue.toNumber());
      totals.totalStockBefore += line.stockBefore;
      totals.totalDifference += line.differenceQuantity;
      return totals;
    },
    { linesCount: 0, totalValue: 0, totalStockBefore: 0, totalDifference: 0 },
  );
}

function mapLineToDto(line: InventoryLineWithRelations): InventoryLineDto {
  return {
    id: line.id,
    productId: line.productId,
    productReference: line.product.reference,
    productName: line.product.name,
    productBarcode: line.product.barcode,
    productUnit: line.product.unit,
    stockBefore: line.stockBefore,
    unitCost: line.unitCost.toNumber(),
    physicalQuantity: line.physicalQuantity,
    differenceQuantity: line.differenceQuantity,
    lineValue: line.lineValue.toNumber(),
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}

function mapInventoryToSummaryDto(inventory: InventoryWithRelations): InventorySummaryDto {
  const totals = computeTotals(inventory.lines);
  return {
    id: inventory.id,
    number: inventory.number,
    displayNumber: `INV-${String(inventory.number).padStart(4, "0")}`,
    status: inventory.status,
    depotId: inventory.depotId,
    depotName: inventory.depot.name,
    createdByUserName: inventory.createdBy.fullName,
    createdAt: inventory.createdAt.toISOString(),
    finishedAt: inventory.finishedAt?.toISOString() ?? null,
    ...totals,
  };
}

function mapInventoryToDto(inventory: InventoryWithRelations): InventoryDto {
  return {
    ...mapInventoryToSummaryDto(inventory),
    lines: inventory.lines.map(mapLineToDto),
  };
}

export async function getInventoryHistory(): Promise<InventorySummaryDto[]> {
  await requireSessionUser(managerRoles);
  const inventories = await prisma.inventory.findMany({
    include: inventoryInclude,
    orderBy: { number: "desc" },
  });
  return inventories.map(mapInventoryToSummaryDto);
}

const inventoryCreateSchema = z.object({
  depotId: z.string().trim().min(1, "Le depot est obligatoire."),
});

export async function createInventory(input: InventoryCreateInput): Promise<InventoryDto> {
  const user = await requireSessionUser(managerRoles);
  const parsed = inventoryCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const inventory = await prisma.$transaction(async (tx) => {
    const depot = await tx.depot.findUnique({
      where: { id: parsed.data.depotId },
      select: { id: true },
    });
    if (!depot) throw new OperationsServiceError("Depot introuvable.", 404);

    const count = await tx.inventory.count();
    const created = await tx.inventory.create({
      data: {
        number: count + 1,
        depotId: depot.id,
        createdByUserId: user.id,
      },
    });

    return tx.inventory.findUniqueOrThrow({
      where: { id: created.id },
      include: inventoryInclude,
    });
  });

  return mapInventoryToDto(inventory);
}

export async function getInventoryById(id: string): Promise<InventoryDto> {
  await requireSessionUser(managerRoles);
  const inventory = await prisma.inventory.findUnique({
    where: { id },
    include: inventoryInclude,
  });
  if (!inventory) throw new OperationsServiceError("Inventaire introuvable.", 404);
  return mapInventoryToDto(inventory);
}

const lineSaveSchema = z.object({
  productId: z.string().trim().min(1, "Le produit est obligatoire."),
  // Deliberately a plain min(0) int, not a truthy check: 0 is a fully valid
  // physical count and must never be treated as "empty".
  physicalQuantity: z.coerce
    .number()
    .int("La quantite doit etre un nombre entier.")
    .min(0, "La quantite ne peut pas etre negative."),
});

/**
 * Saves exactly one line, called on every Enter-after-quantity keystroke.
 * A second save of a product already in this inventory corrects the
 * existing line in place (upsert on the [inventoryId, productId] unique
 * index) instead of creating a duplicate - and never re-snapshots
 * stockBefore/unitCost, which stay frozen to their value the first time the
 * product was added. Returns only the saved line + fresh aggregate totals,
 * not the whole inventory, so the caller never has to refetch a
 * possibly-huge line list just to save one row.
 */
export async function saveInventoryLine(
  inventoryId: string,
  input: InventoryLineSaveInput,
): Promise<{ line: InventoryLineDto; totals: InventoryTotalsDto }> {
  await requireSessionUser(managerRoles);
  const parsed = lineSaveSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperationsServiceError(
      "Certains champs sont invalides.",
      422,
      Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.findUnique({
      where: { id: inventoryId },
      select: { id: true, status: true, depotId: true },
    });
    if (!inventory) throw new OperationsServiceError("Inventaire introuvable.", 404);
    if (inventory.status !== "EN_COURS") {
      throw new OperationsServiceError(
        "Cet inventaire est termine et n'est plus modifiable.",
        409,
      );
    }

    const product = await tx.product.findUnique({
      where: { id: parsed.data.productId },
      select: { id: true, purchasePrice: true, status: true },
    });
    if (!product || product.status !== "ACTIVE") {
      throw new OperationsServiceError("Produit introuvable.", 422);
    }

    const existingLine = await tx.inventoryLine.findUnique({
      where: {
        inventoryId_productId: { inventoryId, productId: parsed.data.productId },
      },
      select: { stockBefore: true, unitCost: true },
    });

    let stockBefore: number;
    let unitCost: number;
    if (existingLine) {
      stockBefore = existingLine.stockBefore;
      unitCost = existingLine.unitCost.toNumber();
    } else {
      const depotLocation = await tx.stockLocation.findUnique({
        where: { depotId: inventory.depotId },
        select: { id: true },
      });
      if (!depotLocation) {
        throw new OperationsServiceError("Emplacement de stock du depot introuvable.", 404);
      }
      const level = await tx.stockLevel.findUnique({
        where: {
          productId_locationId: { productId: parsed.data.productId, locationId: depotLocation.id },
        },
        select: { quantity: true },
      });
      stockBefore = level?.quantity ?? 0;
      unitCost = product.purchasePrice.toNumber();
    }

    const physicalQuantity = parsed.data.physicalQuantity;
    const differenceQuantity = physicalQuantity - stockBefore;
    const lineValue = roundMoney(physicalQuantity * unitCost);

    const saved = await tx.inventoryLine.upsert({
      where: {
        inventoryId_productId: { inventoryId, productId: parsed.data.productId },
      },
      update: { physicalQuantity, differenceQuantity, lineValue },
      create: {
        inventoryId,
        productId: parsed.data.productId,
        stockBefore,
        unitCost,
        physicalQuantity,
        differenceQuantity,
        lineValue,
      },
      include: inventoryLineInclude,
    });

    const allLines = await tx.inventoryLine.findMany({
      where: { inventoryId },
      select: { lineValue: true, stockBefore: true, differenceQuantity: true },
    });
    const totals = allLines.reduce(
      (acc, line) => {
        acc.linesCount += 1;
        acc.totalValue = roundMoney(acc.totalValue + line.lineValue.toNumber());
        acc.totalStockBefore += line.stockBefore;
        acc.totalDifference += line.differenceQuantity;
        return acc;
      },
      { linesCount: 0, totalValue: 0, totalStockBefore: 0, totalDifference: 0 },
    );

    return { line: saved, totals };
  });

  return { line: mapLineToDto(result.line), totals: result.totals };
}

/**
 * "Terminer l'inventaire" is the only action that ever touches real stock:
 * for each line, StockLevel is set to exactly the counted physicalQuantity
 * (matching the "restante reelle" pattern already used for chargements), and
 * an INVENTORY_ADJUSTMENT movement records the delta against whatever the
 * live stock actually is at this moment (not the frozen stockBefore
 * snapshot, which is history/context only) - so nothing is silently
 * double-applied if stock moved during the EN_COURS period.
 */
export async function finalizeInventory(id: string): Promise<InventoryDto> {
  const user = await requireSessionUser(managerRoles);

  const inventory = await prisma.$transaction(
    async (tx) => {
      const current = await tx.inventory.findUnique({
        where: { id },
        select: {
          id: true,
          number: true,
          status: true,
          depotId: true,
          lines: { select: { productId: true, physicalQuantity: true } },
        },
      });
      if (!current) throw new OperationsServiceError("Inventaire introuvable.", 404);
      if (current.status === "TERMINE") {
        throw new OperationsServiceError("Cet inventaire est deja termine.", 409);
      }
      if (current.lines.length === 0) {
        throw new OperationsServiceError(
          "Ajoutez au moins un produit avant de terminer l'inventaire.",
          422,
        );
      }

      const depotLocation = await tx.stockLocation.findUnique({
        where: { depotId: current.depotId },
        select: { id: true },
      });
      if (!depotLocation) {
        throw new OperationsServiceError("Emplacement de stock du depot introuvable.", 404);
      }

      for (const line of current.lines) {
        const level = await tx.stockLevel.findUnique({
          where: {
            productId_locationId: { productId: line.productId, locationId: depotLocation.id },
          },
          select: { quantity: true },
        });
        const liveQuantity = level?.quantity ?? 0;
        const delta = line.physicalQuantity - liveQuantity;
        if (delta === 0) continue;

        await tx.stockLevel.upsert({
          where: {
            productId_locationId: { productId: line.productId, locationId: depotLocation.id },
          },
          update: { quantity: line.physicalQuantity },
          create: {
            productId: line.productId,
            locationId: depotLocation.id,
            quantity: line.physicalQuantity,
            reservedQuantity: 0,
          },
        });

        await tx.stockMovement.create({
          data: {
            movementNumber: await nextMovementNumber(tx),
            type: "INVENTORY_ADJUSTMENT",
            productId: line.productId,
            quantity: Math.abs(delta),
            sourceLocationId: delta < 0 ? depotLocation.id : null,
            destinationLocationId: delta > 0 ? depotLocation.id : null,
            referenceType: "INVENTORY",
            referenceId: current.id,
            reason: "Cloture inventaire - correction stock reel",
            note: JSON.stringify({
              inventoryNumber: current.number,
              previousQuantity: liveQuantity,
              physicalQuantity: line.physicalQuantity,
              delta,
            }),
            createdByUserId: user.id,
            status: "VALIDATED",
          },
        });
      }

      return tx.inventory.update({
        where: { id },
        data: { status: "TERMINE", finishedAt: new Date() },
        include: inventoryInclude,
      });
    },
    { isolationLevel: "Serializable" },
  );

  return mapInventoryToDto(inventory);
}

export function mapInventoryError(error: unknown) {
  if (error instanceof OperationsServiceError) return error;
  const prismaError = error as { code?: string };
  if (prismaError.code === "P2025") {
    return new OperationsServiceError("Inventaire introuvable.", 404);
  }
  return new OperationsServiceError("Une erreur est survenue.", 500);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
