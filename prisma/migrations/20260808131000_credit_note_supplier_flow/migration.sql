ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'SUPPLIER_RETURN';

CREATE TYPE "CreditNotePartyType" AS ENUM ('CUSTOMER', 'SUPPLIER');

ALTER TYPE "CreditNoteReason" ADD VALUE IF NOT EXISTS 'SUPPLIER_ERROR';
ALTER TYPE "CreditNoteReason" ADD VALUE IF NOT EXISTS 'SURPLUS_DELIVERY';
ALTER TYPE "CreditNoteReason" ADD VALUE IF NOT EXISTS 'EXPIRED_PRODUCT';

ALTER TABLE "CreditNote"
ALTER COLUMN "customerId" DROP NOT NULL,
ALTER COLUMN "stockDestinationLocationId" DROP NOT NULL;

ALTER TABLE "CreditNote"
ADD COLUMN "partyType" "CreditNotePartyType" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN "supplierId" TEXT,
ADD COLUMN "stockSourceLocationId" TEXT;

ALTER TABLE "CreditNote"
ADD CONSTRAINT "CreditNote_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditNote"
ADD CONSTRAINT "CreditNote_stockSourceLocationId_fkey"
FOREIGN KEY ("stockSourceLocationId") REFERENCES "StockLocation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "CreditNote_supplierId_idx" ON "CreditNote"("supplierId");
CREATE INDEX "CreditNote_partyType_idx" ON "CreditNote"("partyType");
CREATE INDEX "CreditNote_stockSourceLocationId_idx" ON "CreditNote"("stockSourceLocationId");
