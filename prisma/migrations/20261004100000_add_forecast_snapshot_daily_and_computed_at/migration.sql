-- Dashboard "Intelligence & Prévisions IA": two OPTIONAL columns on the
-- forecast cache. Additive only - existing rows keep NULL (the dashboard then
-- shows "détail journalier indisponible" until the next daily computation) and
-- no business data (sales, stock, accounting) is touched.
--   computedAt:    when the forecast engine produced the row.
--   dailyForecast: the 7 unrounded daily predictions of the product,
--                  [{"date":"YYYY-MM-DD","quantity":1.23}, ...].

-- AlterTable
ALTER TABLE "PurchaseForecastSnapshot"
  ADD COLUMN "computedAt" TIMESTAMP(3),
  ADD COLUMN "dailyForecast" JSONB;
