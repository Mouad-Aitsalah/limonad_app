DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "AccountingAccount"
    WHERE code = '6585'
  ) THEN
    INSERT INTO "AccountingAccount" ("id", "code", "name", "type", "isActive", "createdAt", "updatedAt")
    VALUES (md5(random()::text || clock_timestamp()::text), '6585', 'Frais de timbre', 'EXPENSE', true, NOW(), NOW());
  END IF;
END $$;

UPDATE "AccountingAccount"
SET name = 'Frais de timbre',
    type = 'EXPENSE',
    "updatedAt" = NOW()
WHERE code = '6585';

UPDATE "AccountingAccount"
SET name = 'Etat impot et taxe a payer (TIMBRE)',
    type = 'TAX',
    "updatedAt" = NOW()
WHERE code = '44571';

UPDATE "AccountingSettings" settings
SET "stampExpenseAccountId" = account_6585.id,
    "updatedAt" = NOW()
FROM "AccountingAccount" account_6585
WHERE settings."stampExpenseAccountId" IS NOT NULL
  AND account_6585.code = '6585';

CREATE SEQUENCE IF NOT EXISTS "AccountingEntryLine_operationNumber_seq";

ALTER TABLE "AccountingEntryLine"
ADD COLUMN "operationNumber" INTEGER;

WITH ordered_lines AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS row_num
  FROM "AccountingEntryLine"
)
UPDATE "AccountingEntryLine" line
SET "operationNumber" = ordered_lines.row_num
FROM ordered_lines
WHERE line.id = ordered_lines.id;

SELECT setval(
  '"AccountingEntryLine_operationNumber_seq"',
  COALESCE((SELECT MAX("operationNumber") FROM "AccountingEntryLine"), 0),
  true
);

ALTER TABLE "AccountingEntryLine"
ALTER COLUMN "operationNumber" SET DEFAULT nextval('"AccountingEntryLine_operationNumber_seq"'),
ALTER COLUMN "operationNumber" SET NOT NULL;

CREATE UNIQUE INDEX "AccountingEntryLine_operationNumber_key"
ON "AccountingEntryLine"("operationNumber");

CREATE INDEX "AccountingEntryLine_operationNumber_idx"
ON "AccountingEntryLine"("operationNumber");
