import type { Metadata } from "next";

import { AccountingEntriesView } from "@/components/accounting/accounting-entries-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { listAccountingAccountOptions } from "@/lib/server/accounting";

export const metadata: Metadata = {
  title: "Écritures",
};

export default async function AccountingEntriesPage() {
  const [accounts, user] = await Promise.all([
    listAccountingAccountOptions(),
    getCurrentSessionUser(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Écritures</h1>
        <p className="text-sm text-muted-foreground">
          Créer une écriture comptable manuelle équilibrée.
        </p>
      </div>

      <AccountingEntriesView accounts={accounts} canManage={user?.role === "admin"} />
    </div>
  );
}
