ALTER TABLE "CashDeposit"
  ADD COLUMN "cashSales" DECIMAL(12,2),
  ADD COLUMN "cashExpenses" DECIMAL(12,2),
  ADD COLUMN "availableCash" DECIMAL(12,2),
  ADD COLUMN "suggestedDeposit" DECIMAL(12,2),
  ADD COLUMN "suggestedCashReserve" DECIMAL(12,2),
  ADD COLUMN "countedCash" DECIMAL(12,2),
  ADD COLUMN "cashDifference" DECIMAL(12,2),
  ADD COLUMN "cashRemaining" DECIMAL(12,2);
