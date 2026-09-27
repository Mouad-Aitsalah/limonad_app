-- Forecasting step 4 ("PRÉCALCUL / CACHE"): one row per organisation, business
-- day and product, holding only the ML-side forecast (never currentStock,
-- safetyStock, targetStock or recommendedPurchase - those stay computed live
-- from a fresh stock read). Additive only: no existing business data is altered.

-- CreateTable
CREATE TABLE "PurchaseForecastSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessDay" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "forecast1Day" INTEGER NOT NULL,
    "forecast3Days" INTEGER NOT NULL,
    "forecast7Days" INTEGER NOT NULL,
    "predictedQuantityRaw" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "mae" DOUBLE PRECISION,
    "reliability" TEXT NOT NULL,
    "historyDays" INTEGER NOT NULL,
    "soldDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseForecastSnapshot_organizationId_businessDay_productId_key"
  ON "PurchaseForecastSnapshot"("organizationId", "businessDay", "productId");

-- CreateIndex
CREATE INDEX "PurchaseForecastSnapshot_organizationId_businessDay_idx"
  ON "PurchaseForecastSnapshot"("organizationId", "businessDay");

-- AddForeignKey
ALTER TABLE "PurchaseForecastSnapshot"
  ADD CONSTRAINT "PurchaseForecastSnapshot_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseForecastSnapshot"
  ADD CONSTRAINT "PurchaseForecastSnapshot_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
