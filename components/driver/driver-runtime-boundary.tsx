"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { DriverRuntimeProvider } from "@/hooks/use-driver-runtime";
import { MOBILE_HOME_ROUTE } from "@/lib/auth/browser-home-route";

// Keep the existing GPS runtime mounted while navigating between the
// launcher and driver modules. Leaving this space or logging out still
// unmounts it and runs its existing tracking cleanup.
export function DriverRuntimeBoundary({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const pathname = usePathname();
  const inDriverSpace = pathname === MOBILE_HOME_ROUTE || pathname === "/driver" || pathname.startsWith("/driver/");

  return currentUser?.role === "driver" && inDriverSpace
    ? <DriverRuntimeProvider>{children}</DriverRuntimeProvider>
    : children;
}
