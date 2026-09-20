-- Nullable supplier logo, preserving all existing suppliers without a logo.
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
