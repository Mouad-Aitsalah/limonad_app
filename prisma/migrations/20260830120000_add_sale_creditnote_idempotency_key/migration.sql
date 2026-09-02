-- F5 (Phase 2 audit): idempotency keys for Sale and CreditNote creation.
-- Additive only - no existing column is altered or dropped, no row is
-- touched or backfilled. Mirrors the EmployeeTransaction.idempotencyKey
-- pattern already in use (see 20260826113000_expand_employee_payroll_module
-- and 20260827170000_add_multi_organizations_architecture).
--
-- Nullable column + a unique index on (organizationId, idempotencyKey):
-- Postgres treats NULL as distinct from NULL in a unique index, so every
-- existing row (idempotencyKey IS NULL) is completely unaffected, and the
-- constraint only ever applies once a caller actually supplies a key.

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Sale_organizationId_idempotencyKey_key" ON "Sale"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_organizationId_idempotencyKey_key" ON "CreditNote"("organizationId", "idempotencyKey");
