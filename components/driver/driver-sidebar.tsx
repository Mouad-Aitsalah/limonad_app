"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useSidebar } from "@/hooks/use-sidebar";
import { driverNavItems } from "@/components/driver/driver-nav-items";

export function DriverSidebar() {
  const pathname = usePathname();
  const { mobileOpen, closeMobile } = useSidebar();
  const { logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

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
          "fixed inset-y-0 left-0 z-50 flex w-[286px] flex-col border-r border-[var(--sidebar-border)] bg-[linear-gradient(180deg,#0f223a_0%,#10253f_52%,#0b1a2e_100%)] transition-transform duration-300 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
        )}
      >
        <div className="border-b border-[var(--sidebar-border)] px-5 py-6">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#2b6cb0_0%,#0f7a5d_100%)] text-lg font-bold text-white shadow-[0_18px_35px_rgba(9,21,36,0.28)]">
              C
            </div>
            <div>
              <p className="page-eyebrow text-white/56">COMDIS</p>
              <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                Driver App
              </p>
              <p className="mt-1 text-sm leading-6 text-white/60">
                Stock camion, ventes, clients et tournee.
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
          {driverNavItems.map((item, index) => {
            const active =
              item.href === "/driver"
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-[22px] border px-3 py-3.5 transition-all duration-200",
                  active
                    ? "border-emerald-300/40 bg-[linear-gradient(135deg,rgba(26,49,86,0.96),rgba(15,122,93,0.96))] text-white shadow-[0_20px_34px_rgba(8,20,36,0.32)]"
                    : "border-[var(--sidebar-card-border)] bg-[var(--sidebar-card)] text-white/86 hover:border-white/16 hover:bg-white/8",
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                    active
                      ? "border-white/18 bg-white/12 text-white"
                      : "border-white/10 bg-white/6 text-white/90",
                  )}
                >
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="truncate text-sm font-semibold">{item.label}</span>
                    <span className="ml-auto text-[0.68rem] font-semibold tracking-[0.18em] text-white/58">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className={cn("mt-1 text-xs leading-5", active ? "text-white/78" : "text-white/56")}>
                    Acceder a cet ecran
                  </p>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--sidebar-border)] px-4 py-4">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-[22px] border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white/78 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut aria-hidden="true" className="h-5 w-5 shrink-0" />
            Deconnexion
          </button>
        </div>
      </aside>
    </>
  );
}
