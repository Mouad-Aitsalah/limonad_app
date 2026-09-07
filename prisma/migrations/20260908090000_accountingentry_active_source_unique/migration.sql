-- Phase 2 (sale revision): the accounting entry that links a Sale to its
-- ledger posting must be re-issuable. When an admin edits a validated sale,
-- the old entry (sourceType = 'SALE', sourceId = <saleId>, status POSTED) is
-- contre-passée -> status REVERSED, and a fresh corrected entry is created
-- with the SAME sourceType / sourceId so the Sale <-> active-entry link is
-- preserved (per the explicit requirement: never drop sourceId from the
-- corrected entry).
--
-- The previous FULL unique index on (organizationId, sourceType, sourceId)
-- made that impossible (two rows, same triple). It is replaced by a PARTIAL
-- unique index that ignores REVERSED rows: any number of REVERSED entries
-- may share one source, but at most ONE active (non-REVERSED) entry per
-- source is allowed - exactly the invariant the code relies on.
--
-- Non-destructive: no data is touched, only the index definition. The name
-- is kept identical so the schema footprint is unchanged.
DROP INDEX IF EXISTS "AccountingEntry_organizationId_sourceType_sourceId_key";

CREATE UNIQUE INDEX "AccountingEntry_organizationId_sourceType_sourceId_key"
  ON "AccountingEntry" ("organizationId", "sourceType", "sourceId")
  WHERE "status" <> 'REVERSED';
