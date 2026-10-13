import type { Metadata } from "next";

import { AccountingJournalView } from "@/components/accounting/accounting-journal-view";
import {
  listAccountingAccountOptions,
  listAccountingJournalLines,
} from "@/lib/server/accounting";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Journal comptable",
};

type JournalPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountingJournalPage({
  searchParams,
}: JournalPageProps) {
  await requireModulePage("accounting");
  const params = await searchParams;
  const [lines, accounts] = await Promise.all([
    listAccountingJournalLines(),
    listAccountingAccountOptions(),
  ]);
  const initialAccountId =
    typeof params.account === "string" ? params.account : null;

  return (
    <div className="space-y-6">
      <AccountingJournalView
        initialLines={lines}
        accounts={accounts}
        initialAccountId={initialAccountId}
      />
    </div>
  );
}
