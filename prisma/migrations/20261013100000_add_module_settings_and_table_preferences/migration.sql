-- Per-organisation modules (SUPER_ADMIN) + per-user table column preferences.
-- Additive only: one NULLable column and one new table; no existing table,
-- column, index or row is altered. NULL moduleSettings = every module enabled,
-- so existing organisations behave exactly as before. No preference row =
-- every table shows its default columns.
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "moduleSettings" JSONB;

-- CreateTable
CREATE TABLE "UserTablePreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tableKey" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTablePreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTablePreference_organizationId_idx" ON "UserTablePreference"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTablePreference_userId_organizationId_tableKey_key" ON "UserTablePreference"("userId", "organizationId", "tableKey");

-- AddForeignKey
ALTER TABLE "UserTablePreference" ADD CONSTRAINT "UserTablePreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTablePreference" ADD CONSTRAINT "UserTablePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
