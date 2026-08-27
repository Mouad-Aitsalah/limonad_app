ALTER TABLE "Purchase"
ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'credit_fournisseur',
ADD COLUMN "paymentDate" TIMESTAMP(3),
ADD COLUMN "chequeNumber" TEXT,
ADD COLUMN "bankName" TEXT,
ADD COLUMN "observation" TEXT;

ALTER TABLE "PurchaseLine"
ADD COLUMN "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "PurchaseLine"
SET "taxAmount" = "totalTTC" - "totalHT"
WHERE "taxAmount" = 0;
