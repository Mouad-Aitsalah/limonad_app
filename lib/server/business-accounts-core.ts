import { normalizeAccountCode } from "@/lib/accounting-codes";
import type { Prisma } from "@/lib/generated/prisma/client";
import { OperationsServiceError } from "@/lib/server/service-error";
import type { AccountingAccountType } from "@/types/accounting";

// Moved UNCHANGED from lib/server/business-accounts.ts (which imports it from
// here) so the accounts import links Charge / Tresorerie accounts with exactly
// the same rule, in a module testable without Next.

type DbClient = Prisma.TransactionClient | typeof import("@/lib/prisma").prisma;

/**
 * A business account (Client/Fournisseur/Charge/Tresorerie, managed in
 * /comptes) and an accounting-plan account (AccountingAccount, managed in
 * Comptabilite > Comptes comptables) are two different concepts: one is the
 * operational directory entry, the other is the ledger line écritures post
 * against. This resolves the accounting-plan account a business account
 * should be linked to - reusing an existing one by code (never duplicating
 * it) or creating it on the fly - so every business account with a real
 * accounting number is immediately selectable in "Choisir un compte".
 *
 * Codes that don't look like real accounting-plan numbers (the CHG-/TRE-
 * placeholders auto-generated when the admin leaves "N° compte" blank) are
 * left unlinked, exactly as before, so the chart of accounts isn't polluted
 * with internal placeholder codes.
 */
export async function resolveOrCreateAccountingLink(
  db: DbClient,
  organizationId: string,
  input: { explicitAccountingAccountId: string | null; code: string; name: string; type: AccountingAccountType },
): Promise<string | null> {
  if (input.explicitAccountingAccountId) {
    return input.explicitAccountingAccountId;
  }

  const normalizedCode = normalizeAccountCode(input.code);
  if (!/^\d+$/.test(normalizedCode)) {
    return null;
  }

  const existing = await db.accountingAccount.findFirst({
    where: { code: normalizedCode, organizationId },
    select: { id: true, type: true },
  });

  if (existing) {
    if (existing.type !== input.type) {
      throw new OperationsServiceError(
        `Le compte comptable ${normalizedCode} existe deja avec un type incompatible.`,
        409,
        {
          code: `Le compte comptable ${normalizedCode} existe deja avec un type incompatible.`,
        },
      );
    }
    return existing.id;
  }

  const created = await db.accountingAccount.create({
    data: {
      organizationId,
      code: normalizedCode,
      name: input.name,
      type: input.type,
      isActive: true,
    },
    select: { id: true },
  });
  return created.id;
}
