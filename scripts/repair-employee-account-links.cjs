#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { Client } = require("pg");

const [employeeCodeArg, advanceCodeArg, salaryCodeArg] = process.argv.slice(2);

if (!employeeCodeArg || !advanceCodeArg || !salaryCodeArg) {
  console.error(
    "Usage: node scripts/repair-employee-account-links.cjs <employeeCode> <advanceCode> <salaryCode>",
  );
  process.exit(1);
}

function normalizeAccountCode(value) {
  return String(value).trim().replace(/\s+/g, "");
}

function buildEmployeeAdvanceAccountName(fullName) {
  return `Avances et acomptes au personnel ${String(fullName).trim()}`;
}

function buildEmployeeSalaryAccountName(fullName) {
  return `Rémunération due au personnel ${String(fullName).trim()}`;
}

async function ensureEmployeeAccount(client, input) {
  const existing = await client.query(
    `
      SELECT "id", "code", "name", "type", "isActive"
      FROM "AccountingAccount"
      WHERE "code" = $1
    `,
    [input.code],
  );

  if (existing.rowCount) {
    const account = existing.rows[0];
    if (account.type !== input.type) {
      throw new Error(
        `Le compte ${input.code} existe deja avec le type ${account.type}, attendu ${input.type}.`,
      );
    }

    const updated = await client.query(
      `
        UPDATE "AccountingAccount"
        SET "name" = $2,
            "isActive" = TRUE,
            "updatedAt" = NOW()
        WHERE "id" = $1
        RETURNING "id", "code", "name", "type", "isActive"
      `,
      [account.id, input.name],
    );

    return updated.rows[0];
  }

  const created = await client.query(
    `
      INSERT INTO "AccountingAccount" (
        "id",
        "code",
        "name",
        "type",
        "isActive",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
      RETURNING "id", "code", "name", "type", "isActive"
    `,
    [randomUUID(), input.code, input.name, input.type],
  );

  return created.rows[0];
}

async function readEmployeeState(client, employeeCode) {
  const result = await client.query(
    `
      SELECT
        e."id",
        e."employeeCode",
        e."fullName",
        e."advanceAccountId",
        e."salaryAccountId",
        aa."code" AS "advanceCode",
        aa."name" AS "advanceName",
        aa."type" AS "advanceType",
        sa."code" AS "salaryCode",
        sa."name" AS "salaryName",
        sa."type" AS "salaryType"
      FROM "Employee" e
      LEFT JOIN "AccountingAccount" aa
        ON aa."id" = e."advanceAccountId"
      LEFT JOIN "AccountingAccount" sa
        ON sa."id" = e."salaryAccountId"
      WHERE e."employeeCode" = $1
    `,
    [employeeCode],
  );

  return result.rows[0] ?? null;
}

async function readComptesEmployeeRows(client, codes) {
  const result = await client.query(
    `
      SELECT
        a."id",
        a."code" AS "accountNumber",
        a."name",
        'EMPLOYEE' AS "type",
        a."isActive"
      FROM "AccountingAccount" a
      WHERE a."code" = ANY($1::text[])
        AND (
          EXISTS (
            SELECT 1
            FROM "Employee" e
            WHERE e."advanceAccountId" = a."id"
          )
          OR EXISTS (
            SELECT 1
            FROM "Employee" e
            WHERE e."salaryAccountId" = a."id"
          )
        )
      ORDER BY a."code" ASC
    `,
    [codes],
  );

  return result.rows;
}

async function readComptesSummary(client) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "Customer") AS "customerCount",
      (SELECT COUNT(*)::int FROM "Supplier") AS "supplierCount",
      (SELECT COUNT(*)::int FROM "ExpenseAccount") AS "expenseCount",
      (SELECT COUNT(*)::int FROM "TreasuryAccount") AS "treasuryCount",
      (
        SELECT COUNT(*)::int
        FROM "AccountingAccount" a
        WHERE (
          EXISTS (SELECT 1 FROM "Employee" e WHERE e."advanceAccountId" = a."id")
          OR EXISTS (SELECT 1 FROM "Employee" e WHERE e."salaryAccountId" = a."id")
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "ExpenseAccount" expense
          WHERE expense."accountingAccountId" = a."id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "TreasuryAccount" treasury
          WHERE treasury."accountingAccountId" = a."id"
        )
      ) AS "employeeCount"
  `);

  const summary = result.rows[0];
  summary.totalCount =
    summary.customerCount +
    summary.supplierCount +
    summary.expenseCount +
    summary.treasuryCount +
    summary.employeeCount;

  return summary;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const employeeCode = String(employeeCodeArg).trim();
  const advanceCode = normalizeAccountCode(advanceCodeArg);
  const salaryCode = normalizeAccountCode(salaryCodeArg);

  await client.connect();

  try {
    await client.query("BEGIN");

    const employeeResult = await client.query(
      `
        SELECT "id", "employeeCode", "fullName"
        FROM "Employee"
        WHERE "employeeCode" = $1
        FOR UPDATE
      `,
      [employeeCode],
    );

    if (!employeeResult.rowCount) {
      throw new Error(`Employe ${employeeCode} introuvable.`);
    }

    const employee = employeeResult.rows[0];
    const advanceAccount = await ensureEmployeeAccount(client, {
      code: advanceCode,
      name: buildEmployeeAdvanceAccountName(employee.fullName),
      type: "RECEIVABLE",
    });
    const salaryAccount = await ensureEmployeeAccount(client, {
      code: salaryCode,
      name: buildEmployeeSalaryAccountName(employee.fullName),
      type: "PAYABLE",
    });

    await client.query(
      `
        UPDATE "Employee"
        SET "advanceAccountId" = $2,
            "salaryAccountId" = $3,
            "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      [employee.id, advanceAccount.id, salaryAccount.id],
    );

    await client.query("COMMIT");

    const employeeState = await readEmployeeState(client, employeeCode);
    const comptesRows = await readComptesEmployeeRows(client, [advanceCode, salaryCode]);
    const comptesSummary = await readComptesSummary(client);

    console.log(
      JSON.stringify(
        {
          employee: employeeState,
          comptesRows,
          comptesSummary,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
