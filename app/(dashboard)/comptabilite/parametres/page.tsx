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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Paramètres comptables
        </h1>
        <p className="text-sm text-muted-foreground">
          Centralise l&apos;association entre les operations metier et les comptes comptables.
        </p>
      </div>

      <AccountingSettingsView
        initialSettings={settings}
        accounts={accounts}
        canManage={user?.role === "admin"}
      />
    </div>
  );
}
