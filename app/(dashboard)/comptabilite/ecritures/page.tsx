import type { Metadata } from "next";

import { AccountingEntriesView } from "@/components/accounting/accounting-entries-view";
import { getManualEntryAccess } from "@/lib/accounting-entry-access";
import { getCurrentSessionUser } from "@/lib/server/auth";
import {
  getManualAccountingEntry,
  listAccountingAccountOptions,
  listAccountingDraftEntries,
} from "@/lib/server/accounting";

export const metadata: Metadata = {
  title: "Écriture comptable",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountingEntriesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const reviseId = typeof params.revise === "string" ? params.revise : null;
  const user = await getCurrentSessionUser();
  // Same policy the server enforces (lib/accounting-entry-access.ts): admins
  // do everything, a cashier only enters + validates an entry (no drafts, no
  // correction), every other role sees the "reserved" notice.
  const access = getManualEntryAccess(user?.role);

  const [accounts, drafts, reviseEntry] = await Promise.all([
    listAccountingAccountOptions(),
    access.canManageDrafts ? listAccountingDraftEntries() : Promise.resolve([]),
    access.canRevise && reviseId ? getManualAccountingEntry(reviseId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Écriture comptable</h1>
        <p className="text-sm text-muted-foreground">
          Préparer, archiver et valider des écritures comptables manuelles.
        </p>
      </div>

      <AccountingEntriesView
        accounts={accounts}
        canManage={access.canEnter}
        canManageDrafts={access.canManageDrafts}
        initialDrafts={drafts}
        reviseEntry={reviseEntry ?? null}
      />
    </div>
  );
}
