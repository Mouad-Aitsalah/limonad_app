-- Nullable by design: sales created before this migration keep their
-- historical payment data untouched and are NEVER backfilled. A NULL
-- bankAccountingAccountId on an old BANK_TRANSFER sale keeps using the
-- org's default bank account in accounting, exactly as before. Every NEW
-- BANK_TRANSFER sale is required (in the service layer) to carry a real,
-- active, same-org 5141 account id.
ALTER TABLE "Sale" ADD COLUMN "bankAccountingAccountId" TEXT;

CREATE INDEX "Sale_bankAccountingAccountId_idx"
  ON "Sale"("bankAccountingAccountId");

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_bankAccountingAccountId_fkey"
  FOREIGN KEY ("bankAccountingAccountId")
  REFERENCES "AccountingAccount"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
