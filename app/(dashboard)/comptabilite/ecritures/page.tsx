import type { Metadata } from "next";

import { AccountingEntriesView } from "@/components/accounting/accounting-entries-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import {
  getManualAccountingEntry,
  listAccountingAccountOptions,
  listAccountingDraftEntries,
} from "@/lib/server/accounting";

export const metadata: Metadata = {
  title: "Écritures",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountingEntriesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const reviseId = typeof params.revise === "string" ? params.revise : null;
  const user = await getCurrentSessionUser();
  const isAdmin = user?.role === "admin";

  const [accounts, drafts, reviseEntry] = await Promise.all([
    listAccountingAccountOptions(),
    isAdmin ? listAccountingDraftEntries() : Promise.resolve([]),
    isAdmin && reviseId ? getManualAccountingEntry(reviseId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Écritures</h1>
        <p className="text-sm text-muted-foreground">
          Préparer, archiver et valider des écritures comptables manuelles.
        </p>
      </div>

      <AccountingEntriesView
        accounts={accounts}
        canManage={isAdmin}
        initialDrafts={drafts}
        reviseEntry={reviseEntry ?? null}
      />
    </div>
  );
}
