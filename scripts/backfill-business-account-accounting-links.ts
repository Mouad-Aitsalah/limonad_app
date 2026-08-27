import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";
import type { $Enums } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const customerAccountPrefix = "3421";
const supplierAccountPrefix = "4411";

/**
 * One-time backfill for the Comptes / Comptabilite disconnect: existing
 * Charge (ExpenseAccount) and Tresorerie (TreasuryAccount) rows created
 * before this fix carry a real accounting number (e.g. "6118") but were
 * never linked to a matching AccountingAccount, so they never showed up in
 * "Nouvelle ecriture > Choisir un compte". This links each one to an
 * existing AccountingAccount by code, or creates it if missing - the exact
 * same find-or-create-by-code logic the app now applies automatically at
 * creation time. Also pre-warms the auxiliary AccountingAccount for
 * existing clients/fournisseurs so they don't have to wait for their first
 * sale/purchase to become selectable.
 *
 * Safe to re-run: every step only acts on rows that are still unlinked /
 * accounts that don't exist yet, and never overwrites or deletes anything.
 */
async function main() {
  let expenseLinked = 0;
  let treasuryLinked = 0;
  let customersWarmed = 0;
  let suppliersWarmed = 0;
  const skippedNonNumeric: string[] = [];

  const expenses = await prisma.expenseAccount.findMany({
    where: { accountingAccountId: null },
    select: { id: true, code: true, name: true },
  });
  for (const expense of expenses) {
    const linked = await linkByCode(expense.code, expense.name, "EXPENSE");
    if (linked === "skipped") {
      skippedNonNumeric.push(`Charge ${expense.code} (${expense.name})`);
      continue;
    }
    await prisma.expenseAccount.update({
      where: { id: expense.id },
      data: { accountingAccountId: linked },
    });
    expenseLinked += 1;
  }

  const treasuries = await prisma.treasuryAccount.findMany({
    where: { accountingAccountId: null },
    select: { id: true, code: true, name: true },
  });
  for (const treasury of treasuries) {
    const linked = await linkByCode(treasury.code, treasury.name, "TREASURY");
    if (linked === "skipped") {
      skippedNonNumeric.push(`Tresorerie ${treasury.code} (${treasury.name})`);
      continue;
    }
    await prisma.treasuryAccount.update({
      where: { id: treasury.id },
      data: { accountingAccountId: linked },
    });
    treasuryLinked += 1;
  }

  const customers = await prisma.customer.findMany({ select: { code: true, name: true } });
  for (const customer of customers) {
    const code = resolveCustomerAuxiliaryCode(customer.code);
    const linked = await linkByCode(code, customer.name, "RECEIVABLE");
    if (linked !== "skipped") customersWarmed += 1;
  }

  const suppliers = await prisma.supplier.findMany({ select: { code: true, name: true } });
  for (const supplier of suppliers) {
    const code = resolveSupplierAuxiliaryCode(supplier.code);
    const linked = await linkByCode(code, supplier.name, "PAYABLE");
    if (linked !== "skipped") suppliersWarmed += 1;
  }

  console.log(`Charges liees: ${expenseLinked}/${expenses.length}`);
  console.log(`Tresoreries liees: ${treasuryLinked}/${treasuries.length}`);
  console.log(`Clients pre-charges: ${customersWarmed}/${customers.length}`);
  console.log(`Fournisseurs pre-charges: ${suppliersWarmed}/${suppliers.length}`);
  if (skippedNonNumeric.length > 0) {
    console.log(
      `Ignores (numero non numerique, ex: CHG-0001/TRE-0001) : ${skippedNonNumeric.length}`,
    );
    for (const line of skippedNonNumeric) console.log(`  - ${line}`);
  }

  await prisma.$disconnect();
}

/**
 * Mirrors lib/server/business-accounts.ts's resolveOrCreateAccountingLink:
 * reuse an existing AccountingAccount by code, or create it. Returns
 * "skipped" for codes that aren't real accounting-plan numbers.
 */
async function linkByCode(
  rawCode: string,
  name: string,
  type: $Enums.AccountingAccountType,
): Promise<string | "skipped"> {
  const code = normalizeAccountCode(rawCode);
  if (!/^\d+$/.test(code)) return "skipped";

  const existing = await prisma.accountingAccount.findUnique({
    where: { code },
    select: { id: true, type: true },
  });
  if (existing) {
    if (existing.type !== type) {
      console.log(
        `  ! ${code} existe deja avec le type ${existing.type} (attendu ${type}) - ignore.`,
      );
      return "skipped";
    }
    return existing.id;
  }

  const created = await prisma.accountingAccount.create({
    data: { code, name, type, isActive: true },
    select: { id: true },
  });
  return created.id;
}

function normalizeAccountCode(code: string) {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

function resolveCustomerAuxiliaryCode(code: string) {
  const normalized = normalizeAccountCode(code);
  if (/^3421\d+$/.test(normalized)) return normalized;
  const legacyMatch = normalized.match(/^CLI-0*(\d+)$/);
  if (legacyMatch) return `${customerAccountPrefix}${Number(legacyMatch[1])}`;
  return normalized;
}

function resolveSupplierAuxiliaryCode(code: string) {
  const normalized = normalizeAccountCode(code);
  if (/^4411\d+$/.test(normalized)) return normalized;
  const legacyMatch = normalized.match(/^FOU-0*(\d+)$/);
  if (legacyMatch) return `${supplierAccountPrefix}${Number(legacyMatch[1])}`;
  return normalized;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
