-- BI Phase 2A: a customer paying down (part of) their credit balance.
-- Deliberately its own table rather than reusing Payment: Payment.saleId is
-- mandatory (every payment is tied to one specific sale), so it cannot
-- represent a free-standing settlement against a customer's running
-- balance. accountingEntryId is wired but never populated yet: ledger
-- posting is Phase 2A-bis by decision.

-- CreateEnum
CREATE TYPE "CustomerSettlementStatus" AS ENUM ('VALIDATED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CustomerSettlement" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "settlementNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" "CustomerSettlementStatus" NOT NULL DEFAULT 'VALIDATED',
    "idempotencyKey" TEXT,
    "accountingEntryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerSettlement_organizationId_settlementNumber_key" ON "CustomerSettlement"("organizationId", "settlementNumber");
CREATE UNIQUE INDEX "CustomerSettlement_organizationId_idempotencyKey_key" ON "CustomerSettlement"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "CustomerSettlement_accountingEntryId_key" ON "CustomerSettlement"("accountingEntryId");
CREATE INDEX "CustomerSettlement_organizationId_idx" ON "CustomerSettlement"("organizationId");
CREATE INDEX "CustomerSettlement_customerId_idx" ON "CustomerSettlement"("customerId");
CREATE INDEX "CustomerSettlement_organizationId_date_idx" ON "CustomerSettlement"("organizationId", "date");

ALTER TABLE "CustomerSettlement" ADD CONSTRAINT "CustomerSettlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerSettlement" ADD CONSTRAINT "CustomerSettlement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerSettlement" ADD CONSTRAINT "CustomerSettlement_accountingEntryId_fkey" FOREIGN KEY ("accountingEntryId") REFERENCES "AccountingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerSettlement" ADD CONSTRAINT "CustomerSettlement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerSettlement" ADD CONSTRAINT "CustomerSettlement_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Multi-tenant, transactional recompute of Customer.currentBalance.
--
-- AUDIT FINDING (do not re-litigate without re-checking): Customer.
-- currentBalance was historically increment-only (3 call sites in
-- counter-sales.ts / driver-sales.ts / pending-sales.ts each do
-- `{ increment: creditAmount }`; zero call site ever decremented it), so on
-- DEV its SUM was wildly higher than the real outstanding debt (seed opening
-- balances that were never paid down in the data).
--
-- AUDIT FINDING on credit notes: a customer CreditNote in this system is
-- always a CASH/BANK refund (CreditNoteRefundMethod has only CASH/BANK, no
-- "credit to account" option) and Sale.status is NEVER set to CREDIT_NOTED
-- by any code path (verified: the value exists in the enum and in one UI
-- label map, nothing else writes it) - so a credit note today does NOT
-- reduce Sale.creditAmount. Left unadjusted, a fully credit-noted credit
-- sale would keep reporting the customer as still owing the original
-- amount, which is what this backfill (and the BI formula in
-- lib/server/customer-settlements.ts#getCustomerDebt) both correct for by
-- subtracting VALIDATED customer credit notes.
--
-- Initial debt = SUM(Sale.creditAmount) for CREDIT/PARTIALLY_PAID,
-- non-cancelled sales, MINUS SUM(VALIDATED customer CreditNote.totalTTC),
-- clamped at >= 0. No CustomerSettlement exists yet at migration time, so
-- this IS the complete "dette initiale" - the same formula the service
-- layer uses going forward, just with a zero settlements term.
--
-- currentBalance remains an OPERATIONAL CACHE ONLY from this point on (used
-- by the credit-limit check on new credit sales) - the BI/source-of-truth
-- receivables figure is always recomputed from Sale/CreditNote/
-- CustomerSettlement directly, never from this column.
UPDATE "Customer" c
SET "currentBalance" = GREATEST(
  0,
  COALESCE((
    SELECT SUM(s."creditAmount")
    FROM "Sale" s
    WHERE s."customerId" = c.id
      AND s.status IN ('CREDIT', 'PARTIALLY_PAID')
  ), 0)
  -
  COALESCE((
    SELECT SUM(cn."totalTTC")
    FROM "CreditNote" cn
    WHERE cn."customerId" = c.id
      AND cn."partyType" = 'CUSTOMER'
      AND cn.status = 'VALIDATED'
  ), 0)
);
