-- Espace Client "Commander en ligne": customer orders (a REQUEST only - submitting
-- one never creates a Sale, Payment, StockMovement or AccountingEntry; the invoice
-- is created later by the POS validation, which links it via convertedSaleId) and
-- a shared, database-backed throttle for the client login (ClientLoginAttempt).
-- Additive only: no existing table, column or row is altered.
-- CreateEnum
CREATE TYPE "CustomerOrderStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'CONVERTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "CustomerOrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "contactPhone" TEXT,
    "note" TEXT,
    "subtotalHT" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "roundingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalTTC" DECIMAL(12,2) NOT NULL,
    "idempotencyKey" TEXT,
    "processedByUserId" TEXT,
    "processedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "convertedSaleId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productReference" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceHT" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "totalTTC" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CustomerOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientLoginAttempt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_convertedSaleId_key" ON "CustomerOrder"("convertedSaleId");

-- CreateIndex
CREATE INDEX "CustomerOrder_organizationId_status_createdAt_idx" ON "CustomerOrder"("organizationId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CustomerOrder_customerId_idx" ON "CustomerOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_organizationId_orderNumber_key" ON "CustomerOrder"("organizationId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_organizationId_idempotencyKey_key" ON "CustomerOrder"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerOrderLine_orderId_idx" ON "CustomerOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "CustomerOrderLine_productId_idx" ON "CustomerOrderLine"("productId");

-- CreateIndex
CREATE INDEX "ClientLoginAttempt_key_createdAt_idx" ON "ClientLoginAttempt"("key", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_processedByUserId_fkey" FOREIGN KEY ("processedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_convertedSaleId_fkey" FOREIGN KEY ("convertedSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

