import type { Metadata } from "next";

import { AccountingEntriesView } from "@/components/accounting/accounting-entries-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import {
  listAccountingAccountOptions,
  listAccountingEntries,
} from "@/lib/server/accounting";

export const metadata: Metadata = {
  title: "Écritures comptables",
};

export default async function AccountingEntriesPage() {
  const [entries, accounts, user] = await Promise.all([
    listAccountingEntries(),
    listAccountingAccountOptions(),
    getCurrentSessionUser(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Écritures comptables
        </h1>
        <p className="text-sm text-muted-foreground">
          Suivez les ecritures regroupees par operation et creez vos ecritures manuelles equilibrees.
        </p>
      </div>

      <AccountingEntriesView
        initialEntries={entries}
        accounts={accounts}
        canManage={user?.role === "admin"}
      />
    </div>
  );
}
