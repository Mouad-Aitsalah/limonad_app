"use client";

import * as React from "react";

import { RouteGuard } from "@/components/auth/route-guard";
import { DriverShell } from "@/components/driver/driver-shell";

export function DriverRuntimeShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RouteGuard allowedRoles={["driver"]} redirectTo="/dashboard">
      <DriverShell>{children}</DriverShell>
    </RouteGuard>
  );
}
