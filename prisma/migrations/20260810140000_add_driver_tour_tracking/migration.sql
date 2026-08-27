-- CreateEnum
CREATE TYPE "TourCustomerVisitStatus" AS ENUM ('NEARBY', 'ARRIVED', 'DELIVERED', 'NO_SALE');

-- CreateTable
CREATE TABLE "TourLocationPing" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracy" DECIMAL(10,2),
    "speed" DECIMAL(10,2),
    "heading" DECIMAL(10,2),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TourLocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourCustomerVisit" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "TourCustomerVisitStatus" NOT NULL DEFAULT 'NEARBY',
    "firstDetectedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "noSaleReason" TEXT,
    "lastKnownDistanceMeters" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourCustomerVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TourLocationPing_tourId_recordedAt_idx" ON "TourLocationPing"("tourId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TourCustomerVisit_tourId_customerId_key" ON "TourCustomerVisit"("tourId", "customerId");

-- CreateIndex
CREATE INDEX "TourCustomerVisit_customerId_idx" ON "TourCustomerVisit"("customerId");

-- CreateIndex
CREATE INDEX "TourCustomerVisit_status_idx" ON "TourCustomerVisit"("status");

-- AddForeignKey
ALTER TABLE "TourLocationPing" ADD CONSTRAINT "TourLocationPing_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourCustomerVisit" ADD CONSTRAINT "TourCustomerVisit_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourCustomerVisit" ADD CONSTRAINT "TourCustomerVisit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
