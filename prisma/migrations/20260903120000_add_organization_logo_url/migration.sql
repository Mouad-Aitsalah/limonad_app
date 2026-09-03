-- Company logo for the sidebar and sales tickets.
-- Nullable, additive; existing rows keep NULL (the "C"/name fallback is used).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
