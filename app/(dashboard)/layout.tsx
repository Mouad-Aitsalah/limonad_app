import type { Metadata } from "next";

import { RouteGuard } from "@/components/auth/route-guard";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export const metadata: Metadata = {
  title: {
    template: "%s | COMDIS",
    default: "COMDIS",
  },
};

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RouteGuard
      allowedRoles={["admin", "depot_manager", "cashier"]}
      redirectTo="/driver"
    >
      <DashboardShell>{children}</DashboardShell>
    </RouteGuard>
  );
}
