import type { Metadata } from "next";

import { RouteGuard } from "@/components/auth/route-guard";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export const metadata: Metadata = {
  title: {
    template: "%s | COMDIS Organisations",
    default: "COMDIS Organisations",
  },
};

export default function OrganizationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RouteGuard allowedRoles={["super_admin"]} redirectTo="/dashboard">
      <DashboardShell>{children}</DashboardShell>
    </RouteGuard>
  );
}
