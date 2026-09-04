-- Allow customers without a phone number before normalizing blank legacy values.
ALTER TABLE "Customer" ALTER COLUMN "phone" DROP NOT NULL;

-- PostgreSQL unique indexes allow multiple NULL values while retaining
-- uniqueness for actual phone numbers.
UPDATE "Customer"
SET "phone" = NULL
WHERE "phone" IS NOT NULL
  AND BTRIM("phone") = '';
