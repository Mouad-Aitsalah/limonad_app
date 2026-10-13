import type { Metadata } from "next";

import { AccountingAccountsView } from "@/components/accounting/accounting-accounts-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { listAccountingAccounts } from "@/lib/server/accounting";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Comptes comptables",
};

export default async function AccountingAccountsPage() {
  await requireModulePage("accounting");
  const [accounts, user] = await Promise.all([
    listAccountingAccounts(),
    getCurrentSessionUser(),
  ]);

  return (
    <div className="space-y-6">
      <AccountingAccountsView
        initialAccounts={accounts}
        canManage={user?.role === "admin"}
      />
    </div>
  );
}
