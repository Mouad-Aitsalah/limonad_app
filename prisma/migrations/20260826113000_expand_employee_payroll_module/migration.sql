-- Extend the first /employes prototype into the full payroll module:
-- employeeCode business key, monthly payroll periods, idempotent validation,
-- accounting linkage, and employee payroll accounting sources.

-- Add new accounting journal source enum values used by the payroll module.
ALTER TYPE "AccountingSourceType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_ADVANCE';
ALTER TYPE "AccountingSourceType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_REMUNERATION';
ALTER TYPE "AccountingSourceType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_TRANSFER';

-- Rename the business code column to match the required Prisma contract.
ALTER TABLE "Employee" RENAME COLUMN "code" TO "employeeCode";
ALTER INDEX "Employee_code_key" RENAME TO "Employee_employeeCode_key";

-- Accounting settings: configurable expense account for remuneration posting.
ALTER TABLE "AccountingSettings"
ADD COLUMN "employeePayrollExpenseAccountId" TEXT;

CREATE INDEX "AccountingSettings_employeePayrollExpenseAccountId_idx"
ON "AccountingSettings"("employeePayrollExpenseAccountId");

ALTER TABLE "AccountingSettings"
ADD CONSTRAINT "AccountingSettings_employeePayrollExpenseAccountId_fkey"
FOREIGN KEY ("employeePayrollExpenseAccountId") REFERENCES "AccountingAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Employee payroll operations: monthly period, validation metadata, accounting link.
ALTER TABLE "EmployeeTransaction"
ADD COLUMN "payrollYear" INTEGER,
ADD COLUMN "payrollMonth" INTEGER,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "validatedAt" TIMESTAMP(3),
ADD COLUMN "validatedByUserId" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledByUserId" TEXT,
ADD COLUMN "accountingEntryId" TEXT;

UPDATE "EmployeeTransaction"
SET
  "payrollYear" = EXTRACT(YEAR FROM "transactionDate")::INTEGER,
  "payrollMonth" = EXTRACT(MONTH FROM "transactionDate")::INTEGER,
  "validatedAt" = CASE
    WHEN "status" = 'VALIDATED' THEN COALESCE("validatedAt", "createdAt")
    ELSE "validatedAt"
  END,
  "validatedByUserId" = CASE
    WHEN "status" = 'VALIDATED' THEN COALESCE("validatedByUserId", "createdByUserId")
    ELSE "validatedByUserId"
  END;

ALTER TABLE "EmployeeTransaction"
ALTER COLUMN "payrollYear" SET NOT NULL,
ALTER COLUMN "payrollMonth" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Replace the old prototype enum with the final payroll semantics.
CREATE TYPE "EmployeeTransactionType_new" AS ENUM (
  'ADVANCE',
  'REMUNERATION_PERSONNEL',
  'TRANSFER'
);

ALTER TABLE "EmployeeTransaction"
ALTER COLUMN "type" TYPE "EmployeeTransactionType_new"
USING (
  CASE
    WHEN "type"::text = 'ADVANCE' THEN 'ADVANCE'
    WHEN "type"::text = 'DEPOSIT' THEN 'ADVANCE'
    WHEN "type"::text = 'BONUS' THEN 'REMUNERATION_PERSONNEL'
    ELSE 'REMUNERATION_PERSONNEL'
  END
)::"EmployeeTransactionType_new";

DROP TYPE "EmployeeTransactionType";
ALTER TYPE "EmployeeTransactionType_new" RENAME TO "EmployeeTransactionType";

CREATE UNIQUE INDEX "EmployeeTransaction_idempotencyKey_key"
ON "EmployeeTransaction"("idempotencyKey");

CREATE UNIQUE INDEX "EmployeeTransaction_accountingEntryId_key"
ON "EmployeeTransaction"("accountingEntryId");

CREATE INDEX "EmployeeTransaction_payrollYear_payrollMonth_idx"
ON "EmployeeTransaction"("payrollYear", "payrollMonth");

CREATE INDEX "EmployeeTransaction_employeeId_payrollYear_payrollMonth_idx"
ON "EmployeeTransaction"("employeeId", "payrollYear", "payrollMonth");

ALTER TABLE "EmployeeTransaction"
ADD CONSTRAINT "EmployeeTransaction_validatedByUserId_fkey"
FOREIGN KEY ("validatedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeTransaction"
ADD CONSTRAINT "EmployeeTransaction_cancelledByUserId_fkey"
FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeTransaction"
ADD CONSTRAINT "EmployeeTransaction_accountingEntryId_fkey"
FOREIGN KEY ("accountingEntryId") REFERENCES "AccountingEntry"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
