-- Stock before / after of each side of a StockMovement, as structured columns
-- (groundwork for the stock anomaly detection). Four OPTIONAL columns, additive
-- only: every existing row keeps NULL (nothing is reconstructed for past
-- movements) and no business data (stock levels, sales, purchases, accounting)
-- is touched. The existing "note" text is left as is.
--   source*:      stock of the location the goods leave, before / after.
--   destination*: stock of the location the goods enter, before / after.

-- AlterTable
ALTER TABLE "StockMovement"
  ADD COLUMN "sourceQuantityBefore" INTEGER,
  ADD COLUMN "sourceQuantityAfter" INTEGER,
  ADD COLUMN "destinationQuantityBefore" INTEGER,
  ADD COLUMN "destinationQuantityAfter" INTEGER;
