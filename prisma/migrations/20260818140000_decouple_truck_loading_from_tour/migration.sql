-- Decouple TruckLoading ("fiche de chargement") from Tour: a loading no
-- longer needs a Tour to exist. tourId becomes optional; driverId/date move
-- directly onto TruckLoading so the page can resolve the open loading purely
-- from truckId, with no Tour lookup at all.

-- 1. tourId is no longer mandatory
ALTER TABLE "TruckLoading" ALTER COLUMN "tourId" DROP NOT NULL;

-- 2. New columns (nullable first, backfilled below, then locked down)
ALTER TABLE "TruckLoading"
  ADD COLUMN "driverId" TEXT,
  ADD COLUMN "date" DATE,
  ADD COLUMN "loadingYear" INTEGER,
  ADD COLUMN "loadingSequence" INTEGER;

ALTER TABLE "TruckLoadingLine"
  ADD COLUMN "theoreticalRemainingQuantity" INTEGER,
  ADD COLUMN "actualRemainingQuantity" INTEGER;

-- 3. Backfill existing (tour-linked) loadings from their Tour
UPDATE "TruckLoading" tl
SET "driverId" = t."driverId",
    "date" = t."date"
FROM "Tour" t
WHERE tl."tourId" = t.id;

-- 4. Backfill chronological per-year numbering (CHG/{sequence}/{year})
WITH ranked AS (
  SELECT id,
         EXTRACT(YEAR FROM COALESCE("date", "createdAt"))::int AS yr,
         ROW_NUMBER() OVER (
           PARTITION BY EXTRACT(YEAR FROM COALESCE("date", "createdAt"))
           ORDER BY "createdAt", id
         ) AS seq
  FROM "TruckLoading"
)
UPDATE "TruckLoading" tl
SET "loadingYear" = ranked.yr,
    "loadingSequence" = ranked.seq
FROM ranked
WHERE tl.id = ranked.id;

-- 5. driverId/date are now guaranteed populated for every existing row
ALTER TABLE "TruckLoading" ALTER COLUMN "driverId" SET NOT NULL;
ALTER TABLE "TruckLoading" ALTER COLUMN "date" SET NOT NULL;

-- 6. Constraints and indexes
CREATE UNIQUE INDEX "TruckLoading_loadingYear_loadingSequence_key" ON "TruckLoading"("loadingYear", "loadingSequence");
CREATE INDEX "TruckLoading_driverId_idx" ON "TruckLoading"("driverId");
CREATE INDEX "TruckLoading_status_idx" ON "TruckLoading"("status");

ALTER TABLE "TruckLoading"
ADD CONSTRAINT "TruckLoading_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. At most one OPEN (DRAFT) loading per truck at the database level.
-- Partial unique index: Prisma's schema syntax cannot express this, it is
-- SQL-only (documented in the TruckLoading model comment in schema.prisma).
CREATE UNIQUE INDEX "TruckLoading_open_per_truck_key" ON "TruckLoading"("truckId") WHERE status = 'DRAFT';
