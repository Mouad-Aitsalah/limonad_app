-- BI Phase 2A: snapshot of Product.purchasePrice (HT) on SaleLine, so
-- historical gross margin never drifts when Product.purchasePrice changes
-- later. Added nullable first, backfilled from the CURRENT
-- Product.purchasePrice (an APPROXIMATION for pre-existing rows - the exact
-- historical cost was never recorded before this column existed), then made
-- NOT NULL. Every SaleLine created after this migration carries the exact
-- cost of the day (see createCounterSale / createDriverSale in
-- lib/server), and a DRAFT sale collected later never recomputes it.
ALTER TABLE "SaleLine" ADD COLUMN "unitCostHT" DECIMAL(12,2);

UPDATE "SaleLine" sl
SET "unitCostHT" = p."purchasePrice"
FROM "Product" p
WHERE sl."productId" = p.id;

ALTER TABLE "SaleLine" ALTER COLUMN "unitCostHT" SET NOT NULL;
