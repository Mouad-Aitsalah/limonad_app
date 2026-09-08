-- Two purchase price-entry modes (mutually exclusive per purchase).
--   CLASSIC_TTC (default, historical): tax-included unit price + 1 discount.
--   DOUBLE_DISCOUNT_HT: gross HT unit price + two SUCCESSIVE discounts
--     (discountRate2 applies to the price AFTER discountRate).
-- Purely additive: every existing Purchase row becomes CLASSIC_TTC and every
-- existing PurchaseLine gets discountRate2 = 0 via the column defaults. No
-- existing data is rewritten; no historical purchase is ever reclassified.

-- CreateEnum
CREATE TYPE "PurchasePricingMode" AS ENUM ('CLASSIC_TTC', 'DOUBLE_DISCOUNT_HT');

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "pricingMode" "PurchasePricingMode" NOT NULL DEFAULT 'CLASSIC_TTC';

-- AlterTable
ALTER TABLE "PurchaseLine" ADD COLUMN "discountRate2" DECIMAL(5,2) NOT NULL DEFAULT 0;
