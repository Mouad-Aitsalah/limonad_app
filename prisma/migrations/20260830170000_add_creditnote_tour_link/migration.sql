-- F4 (Phase 2 audit): link a CreditNote to the driver/truck/tour it was
-- physically returned on, mirroring Sale.driverId/truckId/tourId exactly.
-- Additive only - all three columns nullable, no existing row touched.
-- Populated exclusively by the new driver-return path (createDriverReturn),
-- never by the existing admin/depot_manager/cashier manual-return path.

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN "driverId" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "truckId" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "tourId" TEXT;

-- CreateIndex
CREATE INDEX "CreditNote_driverId_idx" ON "CreditNote"("driverId");

-- CreateIndex
CREATE INDEX "CreditNote_truckId_idx" ON "CreditNote"("truckId");

-- CreateIndex
CREATE INDEX "CreditNote_tourId_idx" ON "CreditNote"("tourId");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
