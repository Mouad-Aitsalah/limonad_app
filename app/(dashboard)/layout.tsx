import type { Metadata } from "next";

import { RouteGuard } from "@/components/auth/route-guard";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { TableLabelsProvider } from "@/components/table-labels/table-labels-provider";
import { getTableLabelsForShell } from "@/lib/server/organization-settings";

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
  const tableLabels = await getTableLabelsForShell();

  return (
    <RouteGuard
      allowedRoles={["admin", "depot_manager", "cashier"]}
      redirectTo="/driver"
    >
      <TableLabelsProvider initialLabels={tableLabels}>
        <DashboardShell>{children}</DashboardShell>
      </TableLabelsProvider>
    </RouteGuard>
  );
}
