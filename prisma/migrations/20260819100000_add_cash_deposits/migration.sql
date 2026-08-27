-- Cash deposit ("versement de caisse") module for /pos/versements.
-- Reuses Depot (as the POS/register identity, same as Sale.depotId) and
-- PosSession (optional link to the day's session) instead of introducing a
-- parallel register concept.

-- CreateEnum
CREATE TYPE "CashDepositStatus" AS ENUM ('VALIDATED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CashDeposit" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "depotId" TEXT NOT NULL,
    "posSessionId" TEXT,
    "cashTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "checkTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "CashDepositStatus" NOT NULL DEFAULT 'VALIDATED',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashDeposit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashDeposit_number_key" ON "CashDeposit"("number");
CREATE INDEX "CashDeposit_depotId_idx" ON "CashDeposit"("depotId");
CREATE INDEX "CashDeposit_posSessionId_idx" ON "CashDeposit"("posSessionId");
CREATE INDEX "CashDeposit_createdByUserId_idx" ON "CashDeposit"("createdByUserId");
CREATE INDEX "CashDeposit_date_idx" ON "CashDeposit"("date");
CREATE INDEX "CashDeposit_status_idx" ON "CashDeposit"("status");

ALTER TABLE "CashDeposit"
ADD CONSTRAINT "CashDeposit_depotId_fkey"
FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashDeposit"
ADD CONSTRAINT "CashDeposit_posSessionId_fkey"
FOREIGN KEY ("posSessionId") REFERENCES "PosSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashDeposit"
ADD CONSTRAINT "CashDeposit_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CashDepositDenomination" (
    "id" TEXT NOT NULL,
    "cashDepositId" TEXT NOT NULL,
    "denomination" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CashDepositDenomination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashDepositDenomination_cashDepositId_denomination_key" ON "CashDepositDenomination"("cashDepositId", "denomination");
CREATE INDEX "CashDepositDenomination_cashDepositId_idx" ON "CashDepositDenomination"("cashDepositId");

ALTER TABLE "CashDepositDenomination"
ADD CONSTRAINT "CashDepositDenomination_cashDepositId_fkey"
FOREIGN KEY ("cashDepositId") REFERENCES "CashDeposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
