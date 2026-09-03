-- Phase 5B - GPS offline queue + batch sync.
--
-- Adds a phone-generated stable id for a single physical GPS fix so the new
-- POST /api/driver/tour/location/batch endpoint can be idempotent: a batch
-- that is retried after a lost network response collides on
-- (tourId, clientPingId) and is skipped by `createMany({ skipDuplicates })`.
--
-- Purely additive: one nullable column + one unique index. No existing
-- table/column/constraint is altered, no existing row is touched or
-- backfilled. NULL is allowed for the pre-5B single-point paths
-- (/api/driver/tour/location and .../native), and multiple NULLs never
-- conflict in a PostgreSQL unique index, so they keep working unchanged.
-- Safe to apply with no downtime and no data loss.

ALTER TABLE "TourLocationPing" ADD COLUMN IF NOT EXISTS "clientPingId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "TourLocationPing_tourId_clientPingId_key"
  ON "TourLocationPing"("tourId", "clientPingId");
