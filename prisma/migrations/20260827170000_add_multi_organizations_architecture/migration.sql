-- Introduce first-class multi-organization support while preserving every
-- existing mono-organization row by attaching it to the root organization
-- "COMDIS Principal". This migration is intentionally non-destructive:
-- no business data is deleted and legacy analytics tables are left untouched.

DO $$
BEGIN
  CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

CREATE TABLE IF NOT EXISTS "Organization" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tradeName" TEXT,
  "address" TEXT,
  "city" TEXT,
  "country" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_code_key" ON "Organization"("code");

INSERT INTO "Organization" (
  "id",
  "code",
  "name",
  "tradeName",
  "address",
  "city",
  "country",
  "phone",
  "email",
  "status",
  "createdAt",
  "updatedAt"
)
VALUES (
  'org-comdis-principal',
  'COMDIS-PRINCIPAL',
  'COMDIS Principal',
  'COMDIS',
  'Casablanca',
  'Casablanca',
  'Morocco',
  NULL,
  'contact@comdis.local',
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "code" = EXCLUDED."code",
  "name" = EXCLUDED."name",
  "tradeName" = EXCLUDED."tradeName",
  "address" = EXCLUDED."address",
  "city" = EXCLUDED."city",
  "country" = EXCLUDED."country",
  "phone" = EXCLUDED."phone",
  "email" = EXCLUDED."email",
  "status" = EXCLUDED."status",
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "AccountingAccount" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AccountingEntry" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AccountingSettings" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "CashDeposit" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Depot" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Discrepancy" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "EmployeeTransaction" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "ExpenseAccount" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Inventory" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "PosSession" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "StockLevel" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "StockLocation" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Tour" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "TourClosure" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "TreasuryAccount" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Truck" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "TruckLoading" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

UPDATE "AccountingAccount"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "AccountingEntry"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "AccountingSettings"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "AuditLog"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Brand"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "CashDeposit"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Category"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Contact"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "CreditNote"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Customer"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Depot"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Discrepancy"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Driver"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Employee"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "EmployeeTransaction"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "ExpenseAccount"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Inventory"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Payment"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "PosSession"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Product"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Purchase"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Sale"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "StockLevel"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "StockLocation"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "StockMovement"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Supplier"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Tour"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "TourClosure"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "TreasuryAccount"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "Truck"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "TruckLoading"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

UPDATE "User"
SET "organizationId" = 'org-comdis-principal'
WHERE "organizationId" IS NULL;

ALTER TABLE "AccountingSettings" ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "AccountingAccount" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "AccountingEntry" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "AccountingSettings" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Brand" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "CashDeposit" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Contact" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Depot" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Discrepancy" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Driver" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Employee" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "EmployeeTransaction" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ExpenseAccount" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Inventory" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "PosSession" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Purchase" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Sale" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "StockLevel" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "StockLocation" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Tour" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TourClosure" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TreasuryAccount" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Truck" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TruckLoading" ALTER COLUMN "organizationId" SET NOT NULL;

DROP INDEX IF EXISTS "AccountingAccount_code_key";
DROP INDEX IF EXISTS "AccountingEntry_entryNumber_key";
DROP INDEX IF EXISTS "AccountingEntry_sourceType_sourceId_key";
DROP INDEX IF EXISTS "Brand_name_key";
DROP INDEX IF EXISTS "CashDeposit_number_key";
DROP INDEX IF EXISTS "Category_code_key";
DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "Contact_reference_key";
DROP INDEX IF EXISTS "CreditNote_creditNoteNumber_key";
DROP INDEX IF EXISTS "Customer_code_key";
DROP INDEX IF EXISTS "Depot_code_key";
DROP INDEX IF EXISTS "Driver_employeeCode_key";
DROP INDEX IF EXISTS "Employee_employeeCode_key";
DROP INDEX IF EXISTS "EmployeeTransaction_idempotencyKey_key";
DROP INDEX IF EXISTS "EmployeeTransaction_number_key";
DROP INDEX IF EXISTS "ExpenseAccount_code_key";
DROP INDEX IF EXISTS "Inventory_number_key";
DROP INDEX IF EXISTS "Payment_paymentNumber_key";
DROP INDEX IF EXISTS "PosSession_number_key";
DROP INDEX IF EXISTS "Product_barcode_key";
DROP INDEX IF EXISTS "Product_reference_key";
DROP INDEX IF EXISTS "Purchase_purchaseNumber_key";
DROP INDEX IF EXISTS "Sale_invoiceNumber_key";
DROP INDEX IF EXISTS "Sale_saleYear_saleNumber_key";
DROP INDEX IF EXISTS "StockLocation_code_key";
DROP INDEX IF EXISTS "StockMovement_movementNumber_key";
DROP INDEX IF EXISTS "Supplier_code_key";
DROP INDEX IF EXISTS "Tour_code_key";
DROP INDEX IF EXISTS "Tour_truckId_date_key";
DROP INDEX IF EXISTS "TreasuryAccount_code_key";
DROP INDEX IF EXISTS "Truck_code_key";
DROP INDEX IF EXISTS "Truck_registration_key";
DROP INDEX IF EXISTS "TruckLoading_loadingNumber_key";
DROP INDEX IF EXISTS "TruckLoading_loadingYear_loadingSequence_key";
DROP INDEX IF EXISTS "TruckLoading_open_per_truck_key";

CREATE INDEX "AccountingAccount_organizationId_idx" ON "AccountingAccount"("organizationId");
CREATE UNIQUE INDEX "AccountingAccount_organizationId_code_key" ON "AccountingAccount"("organizationId", "code");

CREATE INDEX "AccountingEntry_organizationId_idx" ON "AccountingEntry"("organizationId");
CREATE UNIQUE INDEX "AccountingEntry_organizationId_entryNumber_key" ON "AccountingEntry"("organizationId", "entryNumber");
CREATE UNIQUE INDEX "AccountingEntry_organizationId_sourceType_sourceId_key" ON "AccountingEntry"("organizationId", "sourceType", "sourceId");

CREATE UNIQUE INDEX "AccountingSettings_organizationId_key" ON "AccountingSettings"("organizationId");
CREATE INDEX "AccountingSettings_organizationId_idx" ON "AccountingSettings"("organizationId");

CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

CREATE INDEX "Brand_organizationId_idx" ON "Brand"("organizationId");
CREATE UNIQUE INDEX "Brand_organizationId_name_key" ON "Brand"("organizationId", "name");

CREATE INDEX "CashDeposit_organizationId_idx" ON "CashDeposit"("organizationId");
CREATE UNIQUE INDEX "CashDeposit_organizationId_number_key" ON "CashDeposit"("organizationId", "number");

CREATE INDEX "Category_organizationId_idx" ON "Category"("organizationId");
CREATE UNIQUE INDEX "Category_organizationId_code_key" ON "Category"("organizationId", "code");
CREATE UNIQUE INDEX "Category_organizationId_name_key" ON "Category"("organizationId", "name");

CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");
CREATE UNIQUE INDEX "Contact_organizationId_reference_key" ON "Contact"("organizationId", "reference");

CREATE INDEX "CreditNote_organizationId_idx" ON "CreditNote"("organizationId");
CREATE UNIQUE INDEX "CreditNote_organizationId_creditNoteNumber_key" ON "CreditNote"("organizationId", "creditNoteNumber");

CREATE INDEX "Customer_organizationId_idx" ON "Customer"("organizationId");
CREATE UNIQUE INDEX "Customer_organizationId_code_key" ON "Customer"("organizationId", "code");
CREATE UNIQUE INDEX "Customer_organizationId_phone_key" ON "Customer"("organizationId", "phone");

CREATE INDEX "Depot_organizationId_idx" ON "Depot"("organizationId");
CREATE UNIQUE INDEX "Depot_organizationId_code_key" ON "Depot"("organizationId", "code");

CREATE INDEX "Discrepancy_organizationId_idx" ON "Discrepancy"("organizationId");

CREATE INDEX "Driver_organizationId_idx" ON "Driver"("organizationId");
CREATE UNIQUE INDEX "Driver_organizationId_employeeCode_key" ON "Driver"("organizationId", "employeeCode");

CREATE INDEX "Employee_organizationId_idx" ON "Employee"("organizationId");
CREATE UNIQUE INDEX "Employee_organizationId_employeeCode_key" ON "Employee"("organizationId", "employeeCode");

CREATE INDEX "EmployeeTransaction_organizationId_idx" ON "EmployeeTransaction"("organizationId");
CREATE UNIQUE INDEX "EmployeeTransaction_organizationId_number_key" ON "EmployeeTransaction"("organizationId", "number");
CREATE UNIQUE INDEX "EmployeeTransaction_organizationId_idempotencyKey_key" ON "EmployeeTransaction"("organizationId", "idempotencyKey");

CREATE INDEX "ExpenseAccount_organizationId_idx" ON "ExpenseAccount"("organizationId");
CREATE UNIQUE INDEX "ExpenseAccount_organizationId_code_key" ON "ExpenseAccount"("organizationId", "code");

CREATE INDEX "Inventory_organizationId_idx" ON "Inventory"("organizationId");
CREATE UNIQUE INDEX "Inventory_organizationId_number_key" ON "Inventory"("organizationId", "number");

CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");
CREATE UNIQUE INDEX "Payment_organizationId_paymentNumber_key" ON "Payment"("organizationId", "paymentNumber");

CREATE INDEX "PosSession_organizationId_idx" ON "PosSession"("organizationId");
CREATE UNIQUE INDEX "PosSession_organizationId_year_number_key" ON "PosSession"("organizationId", "year", "number");

CREATE INDEX "Product_organizationId_idx" ON "Product"("organizationId");
CREATE UNIQUE INDEX "Product_organizationId_reference_key" ON "Product"("organizationId", "reference");
CREATE UNIQUE INDEX "Product_organizationId_barcode_key" ON "Product"("organizationId", "barcode");

CREATE INDEX "Purchase_organizationId_idx" ON "Purchase"("organizationId");
CREATE UNIQUE INDEX "Purchase_organizationId_purchaseNumber_key" ON "Purchase"("organizationId", "purchaseNumber");

CREATE INDEX "Sale_organizationId_idx" ON "Sale"("organizationId");
CREATE UNIQUE INDEX "Sale_organizationId_invoiceNumber_key" ON "Sale"("organizationId", "invoiceNumber");
CREATE UNIQUE INDEX "Sale_organizationId_saleYear_saleNumber_key" ON "Sale"("organizationId", "saleYear", "saleNumber");

CREATE INDEX "StockLevel_organizationId_idx" ON "StockLevel"("organizationId");

CREATE INDEX "StockLocation_organizationId_idx" ON "StockLocation"("organizationId");
CREATE UNIQUE INDEX "StockLocation_organizationId_code_key" ON "StockLocation"("organizationId", "code");

CREATE INDEX "StockMovement_organizationId_idx" ON "StockMovement"("organizationId");
CREATE UNIQUE INDEX "StockMovement_organizationId_movementNumber_key" ON "StockMovement"("organizationId", "movementNumber");

CREATE INDEX "Supplier_organizationId_idx" ON "Supplier"("organizationId");
CREATE UNIQUE INDEX "Supplier_organizationId_code_key" ON "Supplier"("organizationId", "code");

CREATE INDEX "Tour_organizationId_idx" ON "Tour"("organizationId");
CREATE UNIQUE INDEX "Tour_organizationId_code_key" ON "Tour"("organizationId", "code");
CREATE UNIQUE INDEX "Tour_organizationId_truckId_date_key" ON "Tour"("organizationId", "truckId", "date");

CREATE INDEX "TourClosure_organizationId_idx" ON "TourClosure"("organizationId");

CREATE INDEX "TreasuryAccount_organizationId_idx" ON "TreasuryAccount"("organizationId");
CREATE UNIQUE INDEX "TreasuryAccount_organizationId_code_key" ON "TreasuryAccount"("organizationId", "code");

CREATE INDEX "Truck_organizationId_idx" ON "Truck"("organizationId");
CREATE UNIQUE INDEX "Truck_organizationId_code_key" ON "Truck"("organizationId", "code");
CREATE UNIQUE INDEX "Truck_organizationId_registration_key" ON "Truck"("organizationId", "registration");

CREATE INDEX "TruckLoading_organizationId_idx" ON "TruckLoading"("organizationId");
CREATE UNIQUE INDEX "TruckLoading_organizationId_loadingNumber_key" ON "TruckLoading"("organizationId", "loadingNumber");
CREATE UNIQUE INDEX "TruckLoading_organizationId_loadingYear_loadingSequence_key" ON "TruckLoading"("organizationId", "loadingYear", "loadingSequence");
CREATE UNIQUE INDEX "TruckLoading_open_per_truck_key"
ON "TruckLoading"("organizationId", "truckId")
WHERE "status" = 'DRAFT';

CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

ALTER TABLE "User"
ADD CONSTRAINT "User_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "Depot"
ADD CONSTRAINT "Depot_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Truck"
ADD CONSTRAINT "Truck_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Driver"
ADD CONSTRAINT "Driver_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Category"
ADD CONSTRAINT "Category_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Brand"
ADD CONSTRAINT "Brand_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Supplier"
ADD CONSTRAINT "Supplier_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Contact"
ADD CONSTRAINT "Contact_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "ExpenseAccount"
ADD CONSTRAINT "ExpenseAccount_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "TreasuryAccount"
ADD CONSTRAINT "TreasuryAccount_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Product"
ADD CONSTRAINT "Product_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "StockLocation"
ADD CONSTRAINT "StockLocation_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "StockLevel"
ADD CONSTRAINT "StockLevel_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Tour"
ADD CONSTRAINT "Tour_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "TruckLoading"
ADD CONSTRAINT "TruckLoading_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "PosSession"
ADD CONSTRAINT "PosSession_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "CashDeposit"
ADD CONSTRAINT "CashDeposit_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Employee"
ADD CONSTRAINT "Employee_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "EmployeeTransaction"
ADD CONSTRAINT "EmployeeTransaction_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "CreditNote"
ADD CONSTRAINT "CreditNote_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Purchase"
ADD CONSTRAINT "Purchase_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "AccountingAccount"
ADD CONSTRAINT "AccountingAccount_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "AccountingEntry"
ADD CONSTRAINT "AccountingEntry_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "AccountingSettings"
ADD CONSTRAINT "AccountingSettings_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "TourClosure"
ADD CONSTRAINT "TourClosure_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Discrepancy"
ADD CONSTRAINT "Discrepancy_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
