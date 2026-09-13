-- PHASE 4A.1 - additive only, no data loss, no destructive change.
-- Sale.soldAt is nullable: every existing row gets NULL (unchanged
-- behaviour - createdAt keeps meaning exactly what it always has for those
-- rows and for every future ONLINE sale). Only a driver sale synced from
-- the offline POS (see syncOfflineDriverSale in lib/server/driver-sales.ts)
-- ever sets this to something different from createdAt.
-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "soldAt" TIMESTAMP(3);
