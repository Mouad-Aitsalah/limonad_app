import type { Metadata } from "next";

import { AccountsView } from "@/components/comptes/accounts-view";
import {
  getBusinessAccountFormOptions,
  getBusinessAccountsPage,
} from "@/lib/server/business-accounts";

export const metadata: Metadata = {
  title: "Comptes",
};

export default async function ComptesPage() {
  const [initialPage, formOptions] = await Promise.all([
    getBusinessAccountsPage(),
    getBusinessAccountFormOptions(),
  ]);

  return (
    <AccountsView
      initialPage={initialPage}
      accountingAccounts={formOptions.accountingAccounts}
    />
  );
}
