import type { Metadata } from "next";

import { AccountingAccountsView } from "@/components/accounting/accounting-accounts-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { listAccountingAccounts } from "@/lib/server/accounting";

export const metadata: Metadata = {
  title: "Comptes comptables",
};

export default async function AccountingAccountsPage() {
  const [accounts, user] = await Promise.all([
    listAccountingAccounts(),
    getCurrentSessionUser(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Comptes comptables
        </h1>
        <p className="text-sm text-muted-foreground">
          Gere le plan comptable sans dupliquer les donnees ni casser les anciennes references.
        </p>
      </div>

      <AccountingAccountsView
        initialAccounts={accounts}
        canManage={user?.role === "admin"}
      />
    </div>
  );
}
