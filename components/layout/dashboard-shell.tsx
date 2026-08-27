"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { SidebarProvider, useSidebar } from "@/hooks/use-sidebar";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Toaster } from "@/components/ui/sonner";

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className="min-h-screen">
      <Sidebar />

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300 ease-out",
          collapsed ? "lg:pl-[104px]" : "lg:pl-[296px]",
        )}
      >
        <Header />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="page-shell">{children}</div>
        </main>
      </div>

      <Toaster position="top-right" />
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </SidebarProvider>
  );
}
