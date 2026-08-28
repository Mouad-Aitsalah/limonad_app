-- Adds GPS accuracy/freshness metadata to Customer, alongside the existing
-- latitude/longitude columns, so a driver-captured customer location can be
-- displayed ("+/- 12 m", "Localisation non renseignee") and distinguished
-- from a stale one without inferring anything from the generic updatedAt
-- column (which changes on every field edit, not just location changes).
-- Nullable, additive, non-destructive.
ALTER TABLE "Customer" ADD COLUMN "locationAccuracy" DECIMAL(10,2);
ALTER TABLE "Customer" ADD COLUMN "locationUpdatedAt" TIMESTAMP(3);
