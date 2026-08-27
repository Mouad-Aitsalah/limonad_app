"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useSidebar } from "@/hooks/use-sidebar";
import { navItems } from "@/components/layout/nav-items";
import { SidebarItem } from "@/components/layout/sidebar-item";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggleCollapsed, mobileOpen, closeMobile } = useSidebar();
  const { currentUser, logout } = useAuth();
  const homeHref = currentUser?.role === "super_admin" ? "/organisations" : "/dashboard";

  const visibleNavItems = navItems.filter(
    (item) =>
      currentUser
        ? currentUser.role === "super_admin"
          ? item.roles?.includes("super_admin") ?? false
          : !item.roles || item.roles.includes(currentUser.role)
        : false,
  );

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#061120]/48 backdrop-blur-sm lg:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[var(--sidebar-border)] bg-[linear-gradient(180deg,#0f223a_0%,#10253f_52%,#0b1a2e_100%)] text-[var(--sidebar-foreground)] transition-all duration-300 ease-out",
          collapsed ? "w-[104px]" : "w-[296px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
        )}
      >
        <div className={cn("border-b border-[var(--sidebar-border)] px-5 py-6", collapsed && "px-3")}>
          <Link
            href={homeHref}
            className={cn("flex items-start gap-3", collapsed && "justify-center")}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#2b6cb0_0%,#0f7a5d_100%)] text-lg font-bold text-white shadow-[0_18px_35px_rgba(9,21,36,0.28)]">
              C
            </div>

            {!collapsed && (
              <div className="min-w-0">
                <p className="page-eyebrow text-white/56">COMDIS</p>
                <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">
                  COMDIS MANAGER
                </p>
                <p className="mt-2 max-w-[190px] text-sm leading-6 text-white/60">
                  Gestion du stock, des ventes, des chauffeurs et de la comptabilite.
                </p>
              </div>
            )}
          </Link>
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
          {visibleNavItems.map((item) => {
            const visibleChildren = item.children?.filter(
              (child) =>
                currentUser
                  ? currentUser.role === "super_admin"
                    ? child.roles?.includes("super_admin") ?? false
                    : !child.roles || child.roles.includes(currentUser.role)
                  : false,
            );
            const active = item.href
              ? pathname === item.href || pathname.startsWith(`${item.href}/`)
              : visibleChildren?.some(
                  (child) =>
                    pathname === child.href || pathname.startsWith(`${child.href}/`),
                ) ?? false;

            return (
              <SidebarItem
                key={item.href ?? item.label}
                item={visibleChildren ? { ...item, children: visibleChildren } : item}
                active={active}
                collapsed={collapsed}
                onNavigate={closeMobile}
                pathname={pathname}
                onExpandSidebar={() => {
                  if (collapsed) toggleCollapsed();
                }}
              />
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-[var(--sidebar-border)] px-4 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={toggleCollapsed}
            className={cn(
              "w-full justify-center border border-white/10 bg-white/6 text-white hover:bg-white/10 hover:text-white",
              !collapsed && "justify-between px-4",
            )}
            aria-label={collapsed ? "Etendre la barre laterale" : "Reduire la barre laterale"}
          >
            {!collapsed ? <span>Reduire</span> : null}
            {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
          </Button>

          {!collapsed ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void logout();
                closeMobile();
              }}
              className="w-full justify-start border border-white/10 bg-transparent px-4 text-white/72 hover:bg-white/8 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Deconnexion
            </Button>
          ) : null}
        </div>
      </aside>
    </>
  );
}
