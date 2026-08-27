-- CreateEnum
CREATE TYPE "PosSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "PosSession" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "status" "PosSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosSession_number_key" ON "PosSession"("number");
CREATE INDEX "PosSession_status_idx" ON "PosSession"("status");
CREATE INDEX "PosSession_openedAt_idx" ON "PosSession"("openedAt");

ALTER TABLE "PosSession"
ADD CONSTRAINT "PosSession_openedByUserId_fkey"
FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add sale numbering + session link
ALTER TABLE "Sale"
ADD COLUMN "saleYear" INTEGER,
ADD COLUMN "saleNumber" INTEGER,
ADD COLUMN "posSessionId" TEXT;

CREATE UNIQUE INDEX "Sale_saleYear_saleNumber_key" ON "Sale"("saleYear", "saleNumber");
CREATE INDEX "Sale_posSessionId_idx" ON "Sale"("posSessionId");

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_posSessionId_fkey"
FOREIGN KEY ("posSessionId") REFERENCES "PosSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
