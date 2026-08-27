-- General-purpose Contacts directory (/contacts), independent from
-- Customer/Supplier, with an optional link to an existing Supplier.

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "supplierId" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contact_reference_key" ON "Contact"("reference");
CREATE INDEX "Contact_supplierId_idx" ON "Contact"("supplierId");
CREATE INDEX "Contact_status_idx" ON "Contact"("status");

ALTER TABLE "Contact"
ADD CONSTRAINT "Contact_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
