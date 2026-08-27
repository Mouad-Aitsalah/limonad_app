-- New standalone physical-inventory module (Inventory / InventoryLine).
-- Independent from the existing /stock stock-adjustment dialog.

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('EN_COURS', 'TERMINE');

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'EN_COURS',
    "depotId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Inventory_number_key" ON "Inventory"("number");
CREATE INDEX "Inventory_status_idx" ON "Inventory"("status");
CREATE INDEX "Inventory_depotId_idx" ON "Inventory"("depotId");
CREATE INDEX "Inventory_createdByUserId_idx" ON "Inventory"("createdByUserId");

ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_depotId_fkey"
FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "InventoryLine" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "physicalQuantity" INTEGER NOT NULL,
    "differenceQuantity" INTEGER NOT NULL,
    "lineValue" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryLine_inventoryId_productId_key" ON "InventoryLine"("inventoryId", "productId");
CREATE INDEX "InventoryLine_productId_idx" ON "InventoryLine"("productId");

ALTER TABLE "InventoryLine"
ADD CONSTRAINT "InventoryLine_inventoryId_fkey"
FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryLine"
ADD CONSTRAINT "InventoryLine_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
