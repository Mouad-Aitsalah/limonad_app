/**
 * Phase 3 - numbering scalability chantier: one-off backfill that
 * initializes DocumentSequence.currentValue for every (organizationId,
 * documentType, scopeKey) combination that already has historical
 * documents, using each generator's OWN historical counting logic
 * (COUNT(*) for the generators that used tx.<model>.count(), MAX(parsed
 * suffix) for the generators that used findFirst/findMany + max-of-suffix).
 *
 * Safe to run more than once: every INSERT uses
 * "ON CONFLICT (organizationId, documentType, scopeKey) DO NOTHING", so an
 * already-backfilled (org, type, scope) row is never touched again, and no
 * existing document is ever renumbered - this script only ever creates the
 * starting counter row, it never rewrites documentNumber/code columns.
 *
 * Run with:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/backfill-document-sequences.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../lib/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type Row = { organizationId: string; scopeKey: string; currentValue: bigint | number };

async function backfill(label: string, documentType: string, sql: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Row[]>(sql);
  if (rows.length === 0) {
    console.log(`  ${label}: no historical rows, nothing to backfill`);
    return;
  }
  let inserted = 0;
  for (const row of rows) {
    const result = await prisma.$executeRaw`
      INSERT INTO "DocumentSequence" ("id", "organizationId", "documentType", "scopeKey", "currentValue", "createdAt", "updatedAt")
      VALUES (md5(random()::text || clock_timestamp()::text), ${row.organizationId}, ${documentType}, ${row.scopeKey}, ${Number(row.currentValue)}, NOW(), NOW())
      ON CONFLICT ("organizationId", "documentType", "scopeKey") DO NOTHING
    `;
    inserted += result;
  }
  console.log(`  ${label}: ${rows.length} (org, scope) combinations found, ${inserted} new counter rows inserted`);
}

async function main() {
  console.log("Backfilling DocumentSequence from historical data...\n");

  // --- Org-global counters, COUNT(*)-based (old logic used tx.<model>.count()) ---
  await backfill(
    "StockMovement (global, no format filter - matches old count() semantics exactly)",
    "STOCK_MOVEMENT",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", COUNT(*) AS "currentValue"
      FROM "StockMovement"
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "Payment (global)",
    "PAYMENT",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", COUNT(*) AS "currentValue"
      FROM "Payment"
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "TruckLoading loadingNumber (global, CHG-######)",
    "LOADING_NUMBER",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", COUNT(*) AS "currentValue"
      FROM "TruckLoading"
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "Inventory (global, INV-####)",
    "INVENTORY",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", COUNT(*) AS "currentValue"
      FROM "Inventory"
      GROUP BY "organizationId"
    `,
  );

  // --- Org-global counters, MAX(parsed suffix)-based (old logic used findFirst/findMany + max) ---
  await backfill(
    "Customer code (3421N)",
    "CUSTOMER_CODE",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", MAX((substring(code from '^3421(\\d+)$'))::bigint) AS "currentValue"
      FROM "Customer"
      WHERE code ~ '^3421\\d+$'
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "PosSession.number (Int column, global)",
    "POS_SESSION",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", MAX(number) AS "currentValue"
      FROM "PosSession"
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "Supplier code (4411N)",
    "SUPPLIER_CODE",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", MAX((substring(code from '^4411(\\d+)$'))::bigint) AS "currentValue"
      FROM "Supplier"
      WHERE code ~ '^4411\\d+$'
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "ExpenseAccount code (CHG-####)",
    "EXPENSE_ACCOUNT_CODE",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", MAX((substring(code from '^CHG-(\\d+)$'))::bigint) AS "currentValue"
      FROM "ExpenseAccount"
      WHERE code ~ '^CHG-\\d+$'
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "TreasuryAccount code (TRE-####)",
    "TREASURY_ACCOUNT_CODE",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", MAX((substring(code from '^TRE-(\\d+)$'))::bigint) AS "currentValue"
      FROM "TreasuryAccount"
      WHERE code ~ '^TRE-\\d+$'
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "Category code (CAT-###)",
    "CATEGORY_CODE",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", MAX((substring(code from '^CAT-(\\d+)$'))::bigint) AS "currentValue"
      FROM "Category"
      WHERE code ~ '^CAT-\\d+$'
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "Purchase number (A-######)",
    "PURCHASE",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", MAX((substring("purchaseNumber" from '^A-(\\d{6})$'))::bigint) AS "currentValue"
      FROM "Purchase"
      WHERE "purchaseNumber" ~ '^A-\\d{6}$'
      GROUP BY "organizationId"
    `,
  );

  await backfill(
    "Driver employeeCode (DRV-####)",
    "DRIVER_EMPLOYEE_CODE",
    Prisma.sql`
      SELECT "organizationId", '' AS "scopeKey", MAX((substring("employeeCode" from '^DRV-(\\d+)$'))::bigint) AS "currentValue"
      FROM "Driver"
      WHERE "employeeCode" ~ '^DRV-\\d+$'
      GROUP BY "organizationId"
    `,
  );

  // --- Year-scoped counters (existing Int year columns, COUNT(*)-based) ---
  await backfill(
    "Sale.saleNumber (per saleYear)",
    "SALE",
    Prisma.sql`
      SELECT "organizationId", "saleYear"::text AS "scopeKey", COUNT(*) AS "currentValue"
      FROM "Sale"
      WHERE "saleYear" IS NOT NULL
      GROUP BY "organizationId", "saleYear"
    `,
  );

  await backfill(
    "TruckLoading.nextLoadingSequence (per loadingYear)",
    "LOADING_SEQUENCE",
    Prisma.sql`
      SELECT "organizationId", "loadingYear"::text AS "scopeKey", COUNT(*) AS "currentValue"
      FROM "TruckLoading"
      WHERE "loadingYear" IS NOT NULL
      GROUP BY "organizationId", "loadingYear"
    `,
  );

  // --- Day-scoped counters, MAX(parsed suffix)-based, day parsed straight out of the stored formatted number ---
  await backfill(
    "StockMovement dated (MV-YYYYMMDD-######, credit-notes.ts variant)",
    "STOCK_MOVEMENT_DATED",
    Prisma.sql`
      SELECT "organizationId",
             substring("movementNumber" from 'MV-(\\d{8})-') AS "scopeKey",
             MAX((substring("movementNumber" from '(\\d{6})$'))::bigint) AS "currentValue"
      FROM "StockMovement"
      WHERE "movementNumber" ~ '^MV-\\d{8}-\\d{6}$'
      GROUP BY "organizationId", substring("movementNumber" from 'MV-(\\d{8})-')
    `,
  );

  await backfill(
    "AccountingEntry number (EC-YYYYMMDD-######)",
    "ACCOUNTING_ENTRY",
    Prisma.sql`
      SELECT "organizationId",
             substring("entryNumber" from 'EC-(\\d{8})-') AS "scopeKey",
             MAX((substring("entryNumber" from '(\\d{6})$'))::bigint) AS "currentValue"
      FROM "AccountingEntry"
      WHERE "entryNumber" ~ '^EC-\\d{8}-\\d{6}$'
      GROUP BY "organizationId", substring("entryNumber" from 'EC-(\\d{8})-')
    `,
  );

  await backfill(
    "CashDeposit number (VER-YYYYMMDD-######)",
    "CASH_DEPOSIT",
    Prisma.sql`
      SELECT "organizationId",
             substring(number from 'VER-(\\d{8})-') AS "scopeKey",
             MAX((substring(number from '(\\d{6})$'))::bigint) AS "currentValue"
      FROM "CashDeposit"
      WHERE number ~ '^VER-\\d{8}-\\d{6}$'
      GROUP BY "organizationId", substring(number from 'VER-(\\d{8})-')
    `,
  );

  await backfill(
    "CreditNote client number (AC-YYYYMMDD-######)",
    "CREDIT_NOTE_CLIENT",
    Prisma.sql`
      SELECT "organizationId",
             substring("creditNoteNumber" from 'AC-(\\d{8})-') AS "scopeKey",
             MAX((substring("creditNoteNumber" from '(\\d{6})$'))::bigint) AS "currentValue"
      FROM "CreditNote"
      WHERE "creditNoteNumber" ~ '^AC-\\d{8}-\\d{6}$'
      GROUP BY "organizationId", substring("creditNoteNumber" from 'AC-(\\d{8})-')
    `,
  );

  await backfill(
    "CreditNote supplier number (AF-YYYYMMDD-######)",
    "CREDIT_NOTE_SUPPLIER",
    Prisma.sql`
      SELECT "organizationId",
             substring("creditNoteNumber" from 'AF-(\\d{8})-') AS "scopeKey",
             MAX((substring("creditNoteNumber" from '(\\d{6})$'))::bigint) AS "currentValue"
      FROM "CreditNote"
      WHERE "creditNoteNumber" ~ '^AF-\\d{8}-\\d{6}$'
      GROUP BY "organizationId", substring("creditNoteNumber" from 'AF-(\\d{8})-')
    `,
  );

  await backfill(
    "Tour code (TOUR-YYYYMMDD-###)",
    "TOUR_CODE",
    Prisma.sql`
      SELECT "organizationId",
             substring(code from 'TOUR-(\\d{8})-') AS "scopeKey",
             MAX((substring(code from '(\\d{3})$'))::bigint) AS "currentValue"
      FROM "Tour"
      WHERE code ~ '^TOUR-\\d{8}-\\d{3}$'
      GROUP BY "organizationId", substring(code from 'TOUR-(\\d{8})-')
    `,
  );

  // --- Month-scoped counter ---
  await backfill(
    "EmployeeTransaction number (SAL-YYYYMM-######)",
    "EMPLOYEE_TRANSACTION",
    Prisma.sql`
      SELECT "organizationId",
             substring(number from 'SAL-(\\d{6})-') AS "scopeKey",
             MAX((substring(number from '(\\d{6})$'))::bigint) AS "currentValue"
      FROM "EmployeeTransaction"
      WHERE number ~ '^SAL-\\d{6}-\\d{6}$'
      GROUP BY "organizationId", substring(number from 'SAL-(\\d{6})-')
    `,
  );

  // --- Composite date+scopeCode counter ---
  await backfill(
    "Sale invoiceNumber (VC-YYYYMMDD-SCOPE-######, SCOPE = 'CTR' or driver.employeeCode e.g. 'DRV-0001')",
    "INVOICE",
    Prisma.sql`
      SELECT "organizationId",
             substring("invoiceNumber" from '^VC-(\\d{8})-') || '-' || substring("invoiceNumber" from '^VC-\\d{8}-(.+)-\\d{6}$') AS "scopeKey",
             MAX((substring("invoiceNumber" from '(\\d{6})$'))::bigint) AS "currentValue"
      FROM "Sale"
      WHERE "invoiceNumber" ~ '^VC-\\d{8}-.+-\\d{6}$'
      GROUP BY "organizationId",
               substring("invoiceNumber" from '^VC-(\\d{8})-') || '-' || substring("invoiceNumber" from '^VC-\\d{8}-(.+)-\\d{6}$')
    `,
  );

  console.log("\nBackfill complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
