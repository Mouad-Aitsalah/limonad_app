import type { Metadata } from "next";

import { AccountingJournalView } from "@/components/accounting/accounting-journal-view";
import {
  listAccountingAccountOptions,
  listAccountingJournalLines,
} from "@/lib/server/accounting";

export const metadata: Metadata = {
  title: "Journal comptable",
};

type JournalPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountingJournalPage({
  searchParams,
}: JournalPageProps) {
  const params = await searchParams;
  const [lines, accounts] = await Promise.all([
    listAccountingJournalLines(),
    listAccountingAccountOptions(),
  ]);
  const initialAccountId =
    typeof params.account === "string" ? params.account : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Journal comptable
        </h1>
        <p className="text-sm text-muted-foreground">
          Consultez l&apos;ensemble des mouvements comptables generes par les operations de l&apos;entreprise.
        </p>
      </div>

      <AccountingJournalView
        initialLines={lines}
        accounts={accounts}
        initialAccountId={initialAccountId}
      />
    </div>
  );
}
