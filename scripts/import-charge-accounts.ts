import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// 6118 - Decalage caisse already exists and must never be touched by this
// import. Listed here only as a safety guard (see the check in main()),
// never as data to insert.
const PROTECTED_CODE = "6118";

const NEW_CHARGE_ACCOUNTS: Array<{ code: string; name: string }> = [
  { code: "6119", name: "R.R.R obtenus sur achats de marchandises" },
  { code: "6123", name: "Achats d'emballages perdus" },
  { code: "6131", name: "Locations et charges locatives" },
  { code: "6133", name: "Entretien et reparations" },
  { code: "6134", name: "Primes d'assurances" },
  { code: "6135", name: "Remuneration du personnel exterieur a l'entreprise" },
  { code: "6142", name: "Transports" },
  { code: "6145", name: "Frais postaux et frais de telecommunications" },
  { code: "6146", name: "Cotisations et dons" },
  { code: "6161", name: "Impots et taxes directs" },
  { code: "6171", name: "Remuneration du personnel" },
  { code: "6256", name: "Transport, nourriture, logement" },
  { code: "6386", name: "Escomptes accordes" },
  { code: "6583", name: "Penalites et amendes fiscales ou penales" },
  { code: "6585", name: "Creances devenues irrecouvrables" },
  { code: "612511", name: "Achats d'eau" },
  { code: "61254", name: "Achats de fournitures de bureau" },
  { code: "61365", name: "Honoraires" },
  { code: "61415", name: "Documentation generale" },
  { code: "61473", name: "Frais et commissions sur services bancaires" },
  { code: "61712", name: "Primes et gratifications" },
  { code: "612512", name: "Achat d'electricite" },
  { code: "612513", name: "Achats de gaz" },
];

/**
 * One-time, idempotent import of the missing "Charge" business accounts for
 * /comptes. Keyed on ExpenseAccount.code (its unique column) - a code
 * already present is skipped entirely, never updated or recreated.
 *
 * Each new account is also linked to a matching AccountingAccount (the real
 * chart-of-accounts entry écritures post against), reusing the exact same
 * find-or-create-by-code logic already used by the /comptes creation form
 * (see resolveOrCreateAccountingLink in lib/server/business-accounts.ts) -
 * except when an AccountingAccount already exists under that code with a
 * DIFFERENT name (see the conflict list below): in that case the link is
 * skipped and reported, rather than silently attaching a new business
 * account to an unrelated, already-live system ledger entry.
 */
async function main() {
  if (NEW_CHARGE_ACCOUNTS.some((account) => account.code === PROTECTED_CODE)) {
    throw new Error(
      `Refus de continuer : ${PROTECTED_CODE} figure dans la liste d'import alors qu'il doit rester intact.`,
    );
  }

  let createdCount = 0;
  let skippedCount = 0;
  const skippedCodes: string[] = [];
  const linkWarnings: string[] = [];
  const organizations = await prisma.organization.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  for (const organization of organizations) {
    for (const account of NEW_CHARGE_ACCOUNTS) {
      const existing = await prisma.expenseAccount.findUnique({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: account.code,
          },
        },
        select: { id: true, name: true },
      });

      if (existing) {
        console.log(
          `deja existant : ignore -> [${organization.code}] ${account.code} (${existing.name})`,
        );
        skippedCount += 1;
        skippedCodes.push(`${organization.code}:${account.code}`);
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const accountingAccountId = await resolveAccountingLink(
          tx,
          organization.id,
          account,
          linkWarnings,
        );
        await tx.expenseAccount.create({
          data: {
            organizationId: organization.id,
            code: account.code,
            name: account.name,
            description: null,
            category: null,
            balance: 0,
            accountingAccountId,
            active: true,
          },
        });
      });

      console.log(`cree : [${organization.code}] ${account.code} - ${account.name}`);
      createdCount += 1;
    }
  }

  console.log("");
  console.log(`Resume : ${createdCount} compte(s) cree(s), ${skippedCount} ignore(s) (deja existants).`);
  if (skippedCodes.length > 0) {
    console.log(`Codes ignores : ${skippedCodes.join(", ")}`);
  }
  if (linkWarnings.length > 0) {
    console.log("");
    console.log(
      "Cree(s) SANS lien comptable automatique (le code existe deja sous un autre nom, compte systeme) :",
    );
    for (const warning of linkWarnings) console.log(`  - ${warning}`);
  }

  const protectedAccounts = await prisma.expenseAccount.findMany({
    where: { code: PROTECTED_CODE },
    select: { organizationId: true, code: true, name: true, updatedAt: true },
    orderBy: { organizationId: "asc" },
  });
  console.log("");
  console.log(
    `Verification ${PROTECTED_CODE} (doit rester inchange) :`,
    JSON.stringify(protectedAccounts),
  );

  const totalCharges = await prisma.expenseAccount.count();
  console.log(`Total de comptes de type Charge en base : ${totalCharges}`);

  await prisma.$disconnect();
}

async function resolveAccountingLink(
  tx: Prisma.TransactionClient,
  organizationId: string,
  account: { code: string; name: string },
  warnings: string[],
): Promise<string | null> {
  const existing = await tx.accountingAccount.findUnique({
    where: {
      organizationId_code: {
        organizationId,
        code: account.code,
      },
    },
    select: { id: true, type: true, name: true },
  });

  if (!existing) {
    const created = await tx.accountingAccount.create({
      data: {
        organizationId,
        code: account.code,
        name: account.name,
        type: "EXPENSE",
        isActive: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  const sameName = normalize(existing.name) === normalize(account.name);
  if (existing.type === "EXPENSE" && sameName) {
    return existing.id;
  }

  warnings.push(
    `[${organizationId}] ${account.code} : compte comptable existant "${existing.name}" (type ${existing.type}) ne correspond pas a "${account.name}".`,
  );
  return null;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
