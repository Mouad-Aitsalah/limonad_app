import type { Metadata } from "next";

import { AccountsView } from "@/components/comptes/accounts-view";
import {
  getBusinessAccountFormOptions,
  getBusinessAccounts,
} from "@/lib/server/business-accounts";

export const metadata: Metadata = {
  title: "Comptes",
};

export default async function ComptesPage() {
  const [accountsPayload, formOptions] = await Promise.all([
    getBusinessAccounts(),
    getBusinessAccountFormOptions(),
  ]);

  return (
    <AccountsView
      initialAccounts={accountsPayload.items}
      initialSummary={accountsPayload.summary}
      accountingAccounts={formOptions.accountingAccounts}
    />
  );
}
