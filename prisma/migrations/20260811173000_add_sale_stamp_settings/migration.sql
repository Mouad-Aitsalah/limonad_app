CREATE TYPE "AccountingStampCalculationMethod" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE_OF_TOTAL_TTC');

ALTER TABLE "Sale"
ADD COLUMN "stampAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "AccountingSettings"
ADD COLUMN "stampEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stampCalculationMethod" "AccountingStampCalculationMethod" NOT NULL DEFAULT 'FIXED_AMOUNT',
ADD COLUMN "stampValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "stampExpenseAccountId" TEXT,
ADD COLUMN "stampPayableAccountId" TEXT;

CREATE INDEX "AccountingSettings_stampExpenseAccountId_idx" ON "AccountingSettings"("stampExpenseAccountId");
CREATE INDEX "AccountingSettings_stampPayableAccountId_idx" ON "AccountingSettings"("stampPayableAccountId");

ALTER TABLE "AccountingSettings"
ADD CONSTRAINT "AccountingSettings_stampExpenseAccountId_fkey"
FOREIGN KEY ("stampExpenseAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccountingSettings"
ADD CONSTRAINT "AccountingSettings_stampPayableAccountId_fkey"
FOREIGN KEY ("stampPayableAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
