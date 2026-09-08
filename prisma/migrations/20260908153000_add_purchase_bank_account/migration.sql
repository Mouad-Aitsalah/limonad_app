-- Nullable by design: purchases created before this migration keep their
-- historical payment data (including bankName and chequeNumber) untouched.
ALTER TABLE "Purchase" ADD COLUMN "bankAccountingAccountId" TEXT;

CREATE INDEX "Purchase_bankAccountingAccountId_idx"
  ON "Purchase"("bankAccountingAccountId");

ALTER TABLE "Purchase"
  ADD CONSTRAINT "Purchase_bankAccountingAccountId_fkey"
  FOREIGN KEY ("bankAccountingAccountId")
  REFERENCES "AccountingAccount"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
