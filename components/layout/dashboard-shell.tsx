"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { isDesktopScaleRoute } from "@/lib/desktop-scale-routes";
import { SidebarProvider, useSidebar } from "@/hooks/use-sidebar";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileHeader } from "@/components/mobile/mobile-header";
import { Toaster } from "@/components/ui/sonner";

/**
 * Marks <html> while a desktop-scaled page is displayed so that portaled UI
 * (dialogs, selects, menus - rendered outside the page container) gets the
 * same x1.3 text scale. See the "Desktop readability" block in globals.css.
 */
function useDesktopScalePopups(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.setAttribute("data-desktop-scale-popups", "");
    return () => root.removeAttribute("data-desktop-scale-popups");
  }, [enabled]);
}

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const desktopScale = isDesktopScaleRoute(pathname);
  useDesktopScalePopups(desktopScale);

  return (
    <div className="mobile-workspace min-h-screen">
      <Sidebar />

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300 ease-out",
          collapsed ? "lg:pl-[104px]" : "lg:pl-[296px]",
        )}
      >
        <Header />
        <MobileHeader />
        <main className="mobile-safe-bottom mobile-safe-x min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="page-shell" data-desktop-scale={desktopScale ? "" : undefined}>
            {children}
          </div>
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
