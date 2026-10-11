import type { Metadata } from "next";

import { AccountingSettingsView } from "@/components/accounting/accounting-settings-view";
import { getCurrentSessionUser } from "@/lib/server/auth";
import {
  getAccountingSettings,
  listAccountingAccountOptions,
} from "@/lib/server/accounting";

export const metadata: Metadata = {
  title: "Paramètres comptables",
};

export default async function AccountingSettingsPage() {
  const [settings, accounts, user] = await Promise.all([
    getAccountingSettings(),
    listAccountingAccountOptions(),
    getCurrentSessionUser(),
  ]);

  return (
    <div className="space-y-6">
      <AccountingSettingsView
        initialSettings={settings}
        accounts={accounts}
        canManage={user?.role === "admin"}
      />
    </div>
  );
}
