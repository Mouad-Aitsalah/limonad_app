-- Quantity pricing (counter POS) + organisation-wide /produits column settings.
-- Additive only: six NULLable / defaulted columns, no existing column, row or
-- index is altered. With these defaults the application behaves exactly as
-- before: quantity pricing is OFF, no product has tiers, Product.salePrice
-- (prix gros) stays the price of every sale.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "productColumnSettings" JSONB,
ADD COLUMN     "quantityPricingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "retailPrice" DECIMAL(12,2),
ADD COLUMN     "semiWholesaleMinQty" INTEGER,
ADD COLUMN     "semiWholesalePrice" DECIMAL(12,2),
ADD COLUMN     "wholesaleMinQty" INTEGER;
