-- CreateEnum
CREATE TYPE "CreditNoteRefundMethod" AS ENUM ('CASH', 'BANK');

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN "refundMethod" "CreditNoteRefundMethod" NOT NULL DEFAULT 'CASH';
