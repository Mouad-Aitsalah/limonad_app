-- Products imported WITH VARIANTS. A variant is a real Product; four columns
-- describe how it is grouped under its parent product.
-- Additive only: four NULLable columns, one unique index and two CHECK constraints.
-- No existing column, index or row is altered. Every existing product keeps all
-- four columns NULL (= an ordinary product), so nothing behaves differently.
--
-- Rollback (manual; Prisma has no down migrations). Only valid while no product
-- has been imported with variants - it drops that metadata:
--   ALTER TABLE "Product" DROP CONSTRAINT "Product_variant_values_check";
--   ALTER TABLE "Product" DROP CONSTRAINT "Product_variant_all_or_none_check";
--   DROP INDEX "Product_variant_identity_key";
--   ALTER TABLE "Product" DROP COLUMN "variantAttributes", DROP COLUMN "variantGroupKey",
--     DROP COLUMN "variantKey", DROP COLUMN "variantParentName";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261013120000_add_product_variant_columns';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "variantAttributes" JSONB,
ADD COLUMN     "variantGroupKey" TEXT,
ADD COLUMN     "variantKey" TEXT,
ADD COLUMN     "variantParentName" TEXT;

-- CreateIndex
-- The name is explicit: the generated one ("Product_organizationId_categoryId_variantGroupKey_variantKey_key")
-- is 64 characters and PostgreSQL would silently truncate it to 63. NULL columns
-- (every existing product) never conflict in a PostgreSQL unique index.
CREATE UNIQUE INDEX "Product_variant_identity_key" ON "Product"("organizationId", "categoryId", "variantGroupKey", "variantKey");

-- AddCheckConstraint
-- Hand-written (Prisma cannot express CHECK constraints, and ignores them when
-- comparing schemas). Product_variant_all_or_none_check: the four variant
-- columns are either all NULL or all set, never half-filled.
ALTER TABLE "Product" ADD CONSTRAINT "Product_variant_all_or_none_check" CHECK (
  ("variantParentName" IS NULL AND "variantGroupKey" IS NULL AND "variantAttributes" IS NULL AND "variantKey" IS NULL)
  OR
  ("variantParentName" IS NOT NULL AND "variantGroupKey" IS NOT NULL AND "variantAttributes" IS NOT NULL AND "variantKey" IS NOT NULL)
);

-- AddCheckConstraint
-- Product_variant_values_check: whenever a variant column is set it must hold
-- something. The three texts need at least one character that is not a blank
-- (space, tab, line breaks, no-break space, the Unicode spaces and the invisible
-- zero-width characters - the same ones lib/products-import-variants.ts strips;
-- written with explicit code points so the result does not depend on the
-- database locale). variantAttributes must be a NON-EMPTY JSON array: the JSON
-- value null, an object, a string, a number or [] are refused. The class is
-- repeated on purpose: a CHECK cannot share a pattern.
ALTER TABLE "Product" ADD CONSTRAINT "Product_variant_values_check" CHECK (
  ("variantParentName" IS NULL OR "variantParentName" ~ '[^ \t\n\r\f\v\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]')
  AND ("variantGroupKey" IS NULL OR "variantGroupKey" ~ '[^ \t\n\r\f\v\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]')
  AND ("variantKey" IS NULL OR "variantKey" ~ '[^ \t\n\r\f\v\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]')
  AND ("variantAttributes" IS NULL OR (jsonb_typeof("variantAttributes") = 'array' AND "variantAttributes" <> '[]'::jsonb))
);
