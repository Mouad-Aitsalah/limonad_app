-- Phase 3 - numbering scalability chantier: a single atomic, per-organization
-- counter table (see the DocumentSequence model doc comment in
-- schema.prisma) that lib/server/document-sequence.ts's
-- reserveDocumentSequence() uses to replace every count()+1 /
-- findFirst-orderBy-desc+1 / findMany+Math.max+1 pattern previously used to
-- generate business document numbers.
--
-- Purely additive: one new table, no existing table is altered, no existing
-- row is touched or deleted. Safe to apply without any downtime or data
-- loss. currentValue is backfilled for every existing (organizationId,
-- documentType, scopeKey) combination by a dedicated one-off script run
-- right after this migration - see the chantier's final report - it is NOT
-- done in this SQL file so that each generator's own historical counting
-- logic (which differs per document type) can be reused exactly.

CREATE TABLE IF NOT EXISTS "DocumentSequence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL DEFAULT '',
  "currentValue" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentSequence_organizationId_documentType_scopeKey_key"
  ON "DocumentSequence"("organizationId", "documentType", "scopeKey");

ALTER TABLE "DocumentSequence"
  ADD CONSTRAINT "DocumentSequence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
