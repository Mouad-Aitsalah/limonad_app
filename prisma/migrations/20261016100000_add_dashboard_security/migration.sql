-- Dashboard security per organisation (SUPER_ADMIN switch + dashboard password).
-- Additive only: one enum and three NEW tables; no existing table, column, index
-- or row is altered, so every organisation keeps its current behaviour (no row =
-- security off).
--
-- Rollback (manual, only if needed - drops the three tables and the enum):
--   DROP TABLE "DashboardUnlockAttempt";
--   DROP TABLE "DashboardAccessGrant";
--   DROP TABLE "OrganizationDashboardSecurity";
--   DROP TYPE "DashboardRenewalPeriod";

-- CreateEnum
CREATE TYPE "DashboardRenewalPeriod" AS ENUM ('ONE_WEEK', 'TWO_WEEKS', 'ONE_MONTH', 'TWO_MONTHS', 'THREE_MONTHS', 'SIX_MONTHS');

-- CreateTable
CREATE TABLE "OrganizationDashboardSecurity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "renewalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "renewalPeriod" "DashboardRenewalPeriod" NOT NULL DEFAULT 'ONE_MONTH',
    "passwordHash" TEXT,
    "passwordSetAt" TIMESTAMP(3),
    "passwordExpiresAt" TIMESTAMP(3),
    "securityVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationDashboardSecurity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardAccessGrant" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "securityVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardUnlockAttempt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardUnlockAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationDashboardSecurity_organizationId_key" ON "OrganizationDashboardSecurity"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardAccessGrant_tokenHash_key" ON "DashboardAccessGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "DashboardAccessGrant_organizationId_idx" ON "DashboardAccessGrant"("organizationId");

-- CreateIndex
CREATE INDEX "DashboardAccessGrant_sessionTokenHash_idx" ON "DashboardAccessGrant"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "DashboardAccessGrant_expiresAt_idx" ON "DashboardAccessGrant"("expiresAt");

-- CreateIndex
CREATE INDEX "DashboardUnlockAttempt_key_createdAt_idx" ON "DashboardUnlockAttempt"("key", "createdAt");

-- AddForeignKey
ALTER TABLE "OrganizationDashboardSecurity" ADD CONSTRAINT "OrganizationDashboardSecurity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardAccessGrant" ADD CONSTRAINT "DashboardAccessGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
