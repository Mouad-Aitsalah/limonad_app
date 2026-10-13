import type { Metadata } from "next";

import { RouteGuard } from "@/components/auth/route-guard";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { TableColumnsProvider } from "@/components/table-columns/table-columns-provider";
import { TableLabelsProvider } from "@/components/table-labels/table-labels-provider";
import { getTableLabelsForShell } from "@/lib/server/organization-settings";
import { getTablePreferencesForShell } from "@/lib/server/table-preferences";

export const metadata: Metadata = {
  title: {
    template: "%s | COMDIS",
    default: "COMDIS",
  },
};

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The organisation's custom column labels (Paramètres -> Personnalisation
  // des tableaux), loaded here once so every table shows them from its first
  // render. {} without a session: the tables show their default labels.
  // The signed-in admin's own column choices ("Personnaliser les colonnes"),
  // {} for every other role: those tables show their default columns.
  const tableLabels = await getTableLabelsForShell();
  const tablePreferences = await getTablePreferencesForShell();

  return (
    <RouteGuard
      allowedRoles={["admin", "depot_manager", "cashier"]}
      redirectTo="/driver"
    >
      <TableLabelsProvider initialLabels={tableLabels}>
        <TableColumnsProvider initialPreferences={tablePreferences}>
          <DashboardShell>{children}</DashboardShell>
        </TableColumnsProvider>
      </TableLabelsProvider>
    </RouteGuard>
  );
}
