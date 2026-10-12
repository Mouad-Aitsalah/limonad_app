import type { Metadata } from "next";

import { AccountsView } from "@/components/comptes/accounts-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import {
  getBusinessAccountFormOptions,
  getBusinessAccountsPage,
} from "@/lib/server/business-accounts";

export const metadata: Metadata = {
  title: "Comptes",
};

export default async function ComptesPage() {
  const [initialPage, formOptions, sessionUser] = await Promise.all([
    getBusinessAccountsPage(),
    getBusinessAccountFormOptions(),
    getCurrentSessionUser(),
  ]);

  return (
    <AccountsView
      initialPage={initialPage}
      accountingAccounts={formOptions.accountingAccounts}
      // "Exporter": admin only (the export API refuses every other role anyway)
      canExport={sessionUser?.role === "admin"}
    />
  );
}
