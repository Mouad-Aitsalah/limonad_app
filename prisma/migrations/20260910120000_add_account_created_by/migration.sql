-- Part A: "Créé par" on business accounts.
-- Additive only. All existing rows keep createdByUserId = NULL (no backfill).
-- A deleted user sets the account's createdByUserId to NULL (ON DELETE SET NULL),
-- so the account row is always preserved and "-" is shown in the UI.
-- Customer already tracks its creator (Customer.createdByUserId) and is untouched.

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseAccount" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "TreasuryAccount" ADD COLUMN     "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Supplier_createdByUserId_idx" ON "Supplier"("createdByUserId");

-- CreateIndex
CREATE INDEX "ExpenseAccount_createdByUserId_idx" ON "ExpenseAccount"("createdByUserId");

-- CreateIndex
CREATE INDEX "TreasuryAccount_createdByUserId_idx" ON "TreasuryAccount"("createdByUserId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAccount" ADD CONSTRAINT "ExpenseAccount_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
