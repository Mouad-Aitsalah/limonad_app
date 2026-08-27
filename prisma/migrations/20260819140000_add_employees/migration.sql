-- Employees module (/employes) - independent from User login accounts.
-- Employee.advanceAccountId / salaryAccountId link to the existing
-- AccountingAccount table (chart of accounts), never a duplicated name.

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmployeeTransactionType" AS ENUM ('ADVANCE', 'DEPOSIT', 'BONUS', 'ALLOWANCE');

-- CreateEnum
CREATE TYPE "EmployeeTransactionStatus" AS ENUM ('DRAFT', 'VALIDATED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "hireDate" DATE,
    "salary" DECIMAL(12,2),
    "phone" TEXT,
    "advanceAccountId" TEXT,
    "salaryAccountId" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");
CREATE INDEX "Employee_advanceAccountId_idx" ON "Employee"("advanceAccountId");
CREATE INDEX "Employee_salaryAccountId_idx" ON "Employee"("salaryAccountId");
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

ALTER TABLE "Employee"
ADD CONSTRAINT "Employee_advanceAccountId_fkey"
FOREIGN KEY ("advanceAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Employee"
ADD CONSTRAINT "Employee_salaryAccountId_fkey"
FOREIGN KEY ("salaryAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "EmployeeTransaction" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "type" "EmployeeTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "EmployeeTransactionStatus" NOT NULL DEFAULT 'VALIDATED',
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeTransaction_number_key" ON "EmployeeTransaction"("number");
CREATE INDEX "EmployeeTransaction_employeeId_idx" ON "EmployeeTransaction"("employeeId");
CREATE INDEX "EmployeeTransaction_type_idx" ON "EmployeeTransaction"("type");
CREATE INDEX "EmployeeTransaction_status_idx" ON "EmployeeTransaction"("status");
CREATE INDEX "EmployeeTransaction_transactionDate_idx" ON "EmployeeTransaction"("transactionDate");

ALTER TABLE "EmployeeTransaction"
ADD CONSTRAINT "EmployeeTransaction_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeTransaction"
ADD CONSTRAINT "EmployeeTransaction_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
