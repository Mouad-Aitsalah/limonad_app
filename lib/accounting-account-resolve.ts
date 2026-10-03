import type { AccountingAccountOptionDto } from "@/types/accounting";

export type ResolvedAccount =
  | { status: "empty" }
  | { status: "not-found" }
  | { status: "inactive"; account: AccountingAccountOptionDto }
  | { status: "resolved"; account: AccountingAccountOptionDto };

/**
 * The account number typed on an entry line is only ever a search key into
 * the real chart of accounts - the resolved AccountingAccount.id is what
 * actually gets sent to the server. (Moved out of
 * components/accounting/accounting-entries-view.tsx unchanged, so it can be
 * unit-tested.)
 */
export function resolveAccountByCode(
  accounts: AccountingAccountOptionDto[],
  rawCode: string,
): ResolvedAccount {
  const normalized = rawCode.trim().toUpperCase();
  if (!normalized) return { status: "empty" };
  const match = accounts.find((account) => account.code.trim().toUpperCase() === normalized);
  if (!match) return { status: "not-found" };
  if (!match.isActive) return { status: "inactive", account: match };
  return { status: "resolved", account: match };
}
