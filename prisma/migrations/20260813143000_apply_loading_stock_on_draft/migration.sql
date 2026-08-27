ALTER TABLE "TruckLoading"
ADD COLUMN "stockAppliedAt" TIMESTAMP(3);

ALTER TABLE "TruckLoadingLine"
ADD COLUMN "reloadedQuantity" INTEGER NOT NULL DEFAULT 0;
