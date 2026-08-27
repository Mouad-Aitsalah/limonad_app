"use client";

import * as React from "react";

import { RouteGuard } from "@/components/auth/route-guard";
import { DriverShell } from "@/components/driver/driver-shell";
import { DriverRuntimeProvider } from "@/hooks/use-driver-runtime";

export function DriverRuntimeShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RouteGuard allowedRoles={["driver"]} redirectTo="/dashboard">
      <DriverRuntimeProvider>
        <DriverShell>{children}</DriverShell>
      </DriverRuntimeProvider>
    </RouteGuard>
  );
}
