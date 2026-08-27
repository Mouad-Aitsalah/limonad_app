-- CreateEnum
CREATE TYPE "AccountingAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'TREASURY', 'RECEIVABLE', 'PAYABLE', 'TAX');

-- CreateEnum
CREATE TYPE "AccountingEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AccountingJournalType" AS ENUM ('GENERAL', 'SALES', 'PURCHASES', 'TREASURY', 'CREDIT_NOTES', 'MANUAL');

-- CreateEnum
CREATE TYPE "AccountingSourceType" AS ENUM ('MANUAL_ENTRY', 'SALE', 'CUSTOMER_CREDIT_NOTE', 'SUPPLIER_CREDIT_NOTE', 'PURCHASE', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT');

-- CreateTable
CREATE TABLE "AccountingAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountingAccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingEntry" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "journalType" "AccountingJournalType" NOT NULL DEFAULT 'GENERAL',
    "status" "AccountingEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" "AccountingSourceType",
    "sourceId" TEXT,
    "createdByUserId" TEXT,
    "reversedEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingEntryLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "salesAccountId" TEXT,
    "salesVatAccountId" TEXT,
    "purchaseAccountId" TEXT,
    "purchaseVatAccountId" TEXT,
    "cashAccountId" TEXT,
    "bankAccountId" TEXT,
    "customerAccountId" TEXT,
    "supplierAccountId" TEXT,
    "customerReturnAccountId" TEXT,
    "supplierReturnAccountId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingAccount_code_key" ON "AccountingAccount"("code");

-- CreateIndex
CREATE INDEX "AccountingAccount_type_idx" ON "AccountingAccount"("type");

-- CreateIndex
CREATE INDEX "AccountingAccount_isActive_idx" ON "AccountingAccount"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEntry_entryNumber_key" ON "AccountingEntry"("entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEntry_reversedEntryId_key" ON "AccountingEntry"("reversedEntryId");

-- CreateIndex
CREATE INDEX "AccountingEntry_date_idx" ON "AccountingEntry"("date");

-- CreateIndex
CREATE INDEX "AccountingEntry_journalType_idx" ON "AccountingEntry"("journalType");

-- CreateIndex
CREATE INDEX "AccountingEntry_status_idx" ON "AccountingEntry"("status");

-- CreateIndex
CREATE INDEX "AccountingEntry_createdByUserId_idx" ON "AccountingEntry"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEntry_sourceType_sourceId_key" ON "AccountingEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "AccountingEntryLine_entryId_idx" ON "AccountingEntryLine"("entryId");

-- CreateIndex
CREATE INDEX "AccountingEntryLine_accountId_idx" ON "AccountingEntryLine"("accountId");

-- CreateIndex
CREATE INDEX "AccountingEntryLine_position_idx" ON "AccountingEntryLine"("position");

-- CreateIndex
CREATE INDEX "AccountingSettings_updatedByUserId_idx" ON "AccountingSettings"("updatedByUserId");

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_reversedEntryId_fkey" FOREIGN KEY ("reversedEntryId") REFERENCES "AccountingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntryLine" ADD CONSTRAINT "AccountingEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AccountingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntryLine" ADD CONSTRAINT "AccountingEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_salesVatAccountId_fkey" FOREIGN KEY ("salesVatAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_purchaseAccountId_fkey" FOREIGN KEY ("purchaseAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_purchaseVatAccountId_fkey" FOREIGN KEY ("purchaseVatAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_supplierAccountId_fkey" FOREIGN KEY ("supplierAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_customerReturnAccountId_fkey" FOREIGN KEY ("customerReturnAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_supplierReturnAccountId_fkey" FOREIGN KEY ("supplierReturnAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
