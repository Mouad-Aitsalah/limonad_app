CREATE TABLE "TourStockCount" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "actualQuantity" INTEGER NOT NULL,
    "countedByUserId" TEXT,
    "note" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourStockCount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TourStockCount_tourId_productId_key" ON "TourStockCount"("tourId", "productId");
CREATE INDEX "TourStockCount_productId_idx" ON "TourStockCount"("productId");

ALTER TABLE "TourStockCount"
ADD CONSTRAINT "TourStockCount_tourId_fkey"
FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TourStockCount"
ADD CONSTRAINT "TourStockCount_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
