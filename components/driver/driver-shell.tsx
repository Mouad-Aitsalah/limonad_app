"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { DriverBackgroundHint } from "@/components/driver/driver-background-hint";
import { DriverNearbyCustomerBanner } from "@/components/driver/driver-nearby-customer-banner";
import { SidebarProvider } from "@/hooks/use-sidebar";
import { DriverSidebar } from "@/components/driver/driver-sidebar";
import { DriverHeader } from "@/components/driver/driver-header";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

export function DriverShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTourPage = pathname === "/driver/tournee";

  return (
    <SidebarProvider>
      <div className={cn("min-h-screen", isTourPage ? "bg-background" : "bg-background")}>
        <DriverSidebar />

        <div className="flex min-h-screen flex-col lg:pl-[286px]">
          <DriverBackgroundHint />
          {!isTourPage ? <DriverHeader /> : null}
          {!isTourPage ? <DriverNearbyCustomerBanner /> : null}
          <main className={cn("flex-1", isTourPage ? "p-0" : "px-4 py-5 sm:px-5 sm:py-6")}>
            {isTourPage ? <DriverNearbyCustomerBanner floating /> : null}
            {children}
          </main>
        </div>

        <Toaster position="top-right" />
      </div>
    </SidebarProvider>
  );
}
