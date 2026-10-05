-- Commercial rounding of the final sale total to the nearest 0.50 DH.
-- Two additive columns, no data touched:
--   Sale.roundingAmount       = totalTTC - (subtotalHT + taxAmount): the explicit
--                               rounding difference of the sale (positive: the
--                               customer pays more than HT + VAT, negative: less).
--   CreditNote.roundingAmount = the share of the original sale's rounding that a
--                               credit note gives back (cumulative proportional
--                               rule), so totalTTC = subtotalHT + taxAmount +
--                               roundingAmount holds for credit notes too.
-- Every existing row gets 0: past sales and credit notes keep their exact
-- amounts and the relation above stays true for the whole history.

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "roundingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN "roundingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
