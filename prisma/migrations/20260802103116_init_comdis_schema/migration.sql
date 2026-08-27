-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DEPOT_MANAGER', 'CASHIER', 'DRIVER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "TruckStatus" AS ENUM ('AVAILABLE', 'LOADING', 'ON_TOUR', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "StockLocationType" AS ENUM ('DEPOT', 'TRUCK');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_ENTRY', 'COUNTER_SALE', 'TRUCK_LOADING', 'TRUCK_SALE', 'TOUR_RETURN', 'CUSTOMER_RETURN', 'INVENTORY_ADJUSTMENT', 'BREAKAGE', 'LOSS', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StockMovementStatus" AS ENUM ('VALIDATED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('GROCERY', 'CAFE', 'RESTAURANT', 'SUPERMARKET', 'WHOLESALER', 'COUNTER', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CustomerCreationOrigin" AS ENUM ('ADMIN', 'DRIVER');

-- CreateEnum
CREATE TYPE "TourStatus" AS ENUM ('DRAFT', 'PREPARED', 'LOADED', 'IN_PROGRESS', 'WAITING_FOR_CLOSURE', 'CLOSED', 'CANCELLED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "TruckLoadingStatus" AS ENUM ('DRAFT', 'VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleOrigin" AS ENUM ('COUNTER', 'TRUCK');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PARTIALLY_PAID', 'PAID', 'CREDIT', 'CANCELLED', 'CREDIT_NOTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'CHECK', 'BANK_TRANSFER', 'CREDIT', 'MIXED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'VALIDATED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CreditNoteReason" AS ENUM ('DEFECTIVE_PRODUCT', 'DAMAGED_PRODUCT', 'DELIVERY_ERROR', 'QUANTITY_ERROR', 'NON_COMPLIANT_PRODUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TourClosureStatus" AS ENUM ('DRAFT', 'WAITING_FOR_DIFFERENCE_VALIDATION', 'VALIDATED');

-- CreateEnum
CREATE TYPE "DiscrepancyType" AS ENUM ('MISSING_GOODS', 'BREAKAGE', 'LOSS', 'LOADING_ERROR', 'INPUT_ERROR', 'CASH_ERROR');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('DECLARED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "depotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Depot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Depot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Truck" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "registration" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "capacity" INTEGER,
    "status" "TruckStatus" NOT NULL DEFAULT 'AVAILABLE',
    "depotId" TEXT NOT NULL,
    "defaultDriverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Truck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "truckId" TEXT,
    "phone" TEXT,
    "licenseNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "ice" TEXT,
    "taxId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "brandId" TEXT,
    "defaultSupplierId" TEXT,
    "purchasePrice" DECIMAL(12,2) NOT NULL,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StockLocationType" NOT NULL,
    "depotId" TEXT,
    "truckId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "movementNumber" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sourceLocationId" TEXT,
    "destinationLocationId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedMovementId" TEXT,
    "status" "StockMovementStatus" NOT NULL DEFAULT 'VALIDATED',

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ice" TEXT,
    "taxId" TEXT,
    "contactName" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdByDriverId" TEXT,
    "createdFromTruckId" TEXT,
    "creationOrigin" "CustomerCreationOrigin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tour" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "depotId" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "TourStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruckLoading" (
    "id" TEXT NOT NULL,
    "loadingNumber" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "status" "TruckLoadingStatus" NOT NULL DEFAULT 'DRAFT',
    "validatedAt" TIMESTAMP(3),
    "validatedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TruckLoading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruckLoadingLine" (
    "id" TEXT NOT NULL,
    "loadingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckLoadingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "origin" "SaleOrigin" NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "customerId" TEXT,
    "depotId" TEXT,
    "driverId" TEXT,
    "truckId" TEXT,
    "tourId" TEXT,
    "stockLocationId" TEXT NOT NULL,
    "subtotalHT" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalTTC" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceHT" DECIMAL(12,2) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalHT" DECIMAL(12,2) NOT NULL,
    "totalTTC" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "receivedByUserId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "originalSaleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" "CreditNoteReason" NOT NULL,
    "comment" TEXT,
    "stockDestinationLocationId" TEXT NOT NULL,
    "subtotalHT" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalTTC" DECIMAL(12,2) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "validatedByUserId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteLine" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceHT" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "totalHT" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalTTC" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "purchaseNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "subtotalHT" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalTTC" DECIMAL(12,2) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "validatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderedQuantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitPurchasePrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "totalHT" DECIMAL(12,2) NOT NULL,
    "totalTTC" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourClosure" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "theoreticalStockValue" DECIMAL(12,2),
    "actualStockValue" DECIMAL(12,2),
    "expectedCash" DECIMAL(12,2) NOT NULL,
    "receivedCash" DECIMAL(12,2) NOT NULL,
    "cashDifference" DECIMAL(12,2) NOT NULL,
    "status" "TourClosureStatus" NOT NULL DEFAULT 'DRAFT',
    "controlledByUserId" TEXT,
    "validatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "tourClosureId" TEXT,
    "type" "DiscrepancyType" NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER,
    "amount" DECIMAL(12,2),
    "reason" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'DECLARED',
    "declaredByUserId" TEXT NOT NULL,
    "validatedByUserId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "driverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_depotId_idx" ON "User"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "Depot_code_key" ON "Depot"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_code_key" ON "Truck"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_registration_key" ON "Truck"("registration");

-- CreateIndex
CREATE UNIQUE INDEX "Truck_defaultDriverId_key" ON "Truck"("defaultDriverId");

-- CreateIndex
CREATE INDEX "Truck_depotId_idx" ON "Truck"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_employeeCode_key" ON "Driver"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_truckId_key" ON "Driver"("truckId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_reference_key" ON "Product"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_defaultSupplierId_idx" ON "Product"("defaultSupplierId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_code_key" ON "StockLocation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_depotId_key" ON "StockLocation"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_truckId_key" ON "StockLocation"("truckId");

-- CreateIndex
CREATE INDEX "StockLevel_locationId_idx" ON "StockLevel"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_productId_locationId_key" ON "StockLevel"("productId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_movementNumber_key" ON "StockMovement"("movementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversedMovementId_key" ON "StockMovement"("reversedMovementId");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_sourceLocationId_idx" ON "StockMovement"("sourceLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_destinationLocationId_idx" ON "StockMovement"("destinationLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_createdByUserId_idx" ON "StockMovement"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_createdByUserId_idx" ON "Customer"("createdByUserId");

-- CreateIndex
CREATE INDEX "Customer_createdByDriverId_idx" ON "Customer"("createdByDriverId");

-- CreateIndex
CREATE UNIQUE INDEX "Tour_code_key" ON "Tour"("code");

-- CreateIndex
CREATE INDEX "Tour_date_idx" ON "Tour"("date");

-- CreateIndex
CREATE INDEX "Tour_driverId_idx" ON "Tour"("driverId");

-- CreateIndex
CREATE INDEX "Tour_truckId_idx" ON "Tour"("truckId");

-- CreateIndex
CREATE INDEX "Tour_depotId_idx" ON "Tour"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "Tour_truckId_date_key" ON "Tour"("truckId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TruckLoading_loadingNumber_key" ON "TruckLoading"("loadingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TruckLoading_tourId_key" ON "TruckLoading"("tourId");

-- CreateIndex
CREATE INDEX "TruckLoading_depotId_idx" ON "TruckLoading"("depotId");

-- CreateIndex
CREATE INDEX "TruckLoading_truckId_idx" ON "TruckLoading"("truckId");

-- CreateIndex
CREATE INDEX "TruckLoading_createdByUserId_idx" ON "TruckLoading"("createdByUserId");

-- CreateIndex
CREATE INDEX "TruckLoadingLine_productId_idx" ON "TruckLoadingLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "TruckLoadingLine_loadingId_productId_key" ON "TruckLoadingLine"("loadingId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_invoiceNumber_key" ON "Sale"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt");

-- CreateIndex
CREATE INDEX "Sale_driverId_idx" ON "Sale"("driverId");

-- CreateIndex
CREATE INDEX "Sale_tourId_idx" ON "Sale"("tourId");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "Sale_stockLocationId_idx" ON "Sale"("stockLocationId");

-- CreateIndex
CREATE INDEX "Sale_depotId_idx" ON "Sale"("depotId");

-- CreateIndex
CREATE INDEX "Sale_truckId_idx" ON "Sale"("truckId");

-- CreateIndex
CREATE INDEX "SaleLine_saleId_idx" ON "SaleLine"("saleId");

-- CreateIndex
CREATE INDEX "SaleLine_productId_idx" ON "SaleLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNumber_key" ON "Payment"("paymentNumber");

-- CreateIndex
CREATE INDEX "Payment_saleId_idx" ON "Payment"("saleId");

-- CreateIndex
CREATE INDEX "Payment_receivedByUserId_idx" ON "Payment"("receivedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNumber_key" ON "CreditNote"("creditNoteNumber");

-- CreateIndex
CREATE INDEX "CreditNote_originalSaleId_idx" ON "CreditNote"("originalSaleId");

-- CreateIndex
CREATE INDEX "CreditNote_customerId_idx" ON "CreditNote"("customerId");

-- CreateIndex
CREATE INDEX "CreditNote_stockDestinationLocationId_idx" ON "CreditNote"("stockDestinationLocationId");

-- CreateIndex
CREATE INDEX "CreditNoteLine_creditNoteId_idx" ON "CreditNoteLine"("creditNoteId");

-- CreateIndex
CREATE INDEX "CreditNoteLine_saleLineId_idx" ON "CreditNoteLine"("saleLineId");

-- CreateIndex
CREATE INDEX "CreditNoteLine_productId_idx" ON "CreditNoteLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_purchaseNumber_key" ON "Purchase"("purchaseNumber");

-- CreateIndex
CREATE INDEX "Purchase_supplierId_idx" ON "Purchase"("supplierId");

-- CreateIndex
CREATE INDEX "Purchase_depotId_idx" ON "Purchase"("depotId");

-- CreateIndex
CREATE INDEX "Purchase_createdByUserId_idx" ON "Purchase"("createdByUserId");

-- CreateIndex
CREATE INDEX "PurchaseLine_purchaseId_idx" ON "PurchaseLine"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseLine_productId_idx" ON "PurchaseLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "TourClosure_tourId_key" ON "TourClosure"("tourId");

-- CreateIndex
CREATE INDEX "Discrepancy_tourId_idx" ON "Discrepancy"("tourId");

-- CreateIndex
CREATE INDEX "Discrepancy_tourClosureId_idx" ON "Discrepancy"("tourClosureId");

-- CreateIndex
CREATE INDEX "Discrepancy_productId_idx" ON "Discrepancy"("productId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_defaultDriverId_fkey" FOREIGN KEY ("defaultDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversedMovementId_fkey" FOREIGN KEY ("reversedMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdByDriverId_fkey" FOREIGN KEY ("createdByDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdFromTruckId_fkey" FOREIGN KEY ("createdFromTruckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tour" ADD CONSTRAINT "Tour_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckLoading" ADD CONSTRAINT "TruckLoading_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckLoading" ADD CONSTRAINT "TruckLoading_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckLoading" ADD CONSTRAINT "TruckLoading_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckLoading" ADD CONSTRAINT "TruckLoading_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckLoading" ADD CONSTRAINT "TruckLoading_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckLoadingLine" ADD CONSTRAINT "TruckLoadingLine_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "TruckLoading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckLoadingLine" ADD CONSTRAINT "TruckLoadingLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_originalSaleId_fkey" FOREIGN KEY ("originalSaleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_stockDestinationLocationId_fkey" FOREIGN KEY ("stockDestinationLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourClosure" ADD CONSTRAINT "TourClosure_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourClosure" ADD CONSTRAINT "TourClosure_controlledByUserId_fkey" FOREIGN KEY ("controlledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourClosure" ADD CONSTRAINT "TourClosure_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_tourClosureId_fkey" FOREIGN KEY ("tourClosureId") REFERENCES "TourClosure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_declaredByUserId_fkey" FOREIGN KEY ("declaredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
