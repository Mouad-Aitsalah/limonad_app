-- CreateEnum
CREATE TYPE "TreasuryAccountKind" AS ENUM ('CASH', 'BANK');

-- CreateTable
CREATE TABLE "ExpenseAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "accountingAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TreasuryAccountKind" NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "accountingAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseAccount_code_key" ON "ExpenseAccount"("code");

-- CreateIndex
CREATE INDEX "ExpenseAccount_accountingAccountId_idx" ON "ExpenseAccount"("accountingAccountId");

-- CreateIndex
CREATE INDEX "ExpenseAccount_active_idx" ON "ExpenseAccount"("active");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryAccount_code_key" ON "TreasuryAccount"("code");

-- CreateIndex
CREATE INDEX "TreasuryAccount_accountingAccountId_idx" ON "TreasuryAccount"("accountingAccountId");

-- CreateIndex
CREATE INDEX "TreasuryAccount_active_idx" ON "TreasuryAccount"("active");

-- CreateIndex
CREATE INDEX "TreasuryAccount_kind_idx" ON "TreasuryAccount"("kind");

-- AddForeignKey
ALTER TABLE "ExpenseAccount" ADD CONSTRAINT "ExpenseAccount_accountingAccountId_fkey" FOREIGN KEY ("accountingAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_accountingAccountId_fkey" FOREIGN KEY ("accountingAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
