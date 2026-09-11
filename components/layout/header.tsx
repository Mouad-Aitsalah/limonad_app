"use client";

import { usePathname } from "next/navigation";

import { useAuth } from "@/hooks/use-auth";
import { getNavigationPageLabel } from "@/components/layout/navigation";
import { UserMenu } from "@/components/layout/user-menu";

export function Header() {
  const pathname = usePathname();
  const { currentUser } = useAuth();
  // Shared with MobileHeader's title resolution - picks the most specific
  // href match (respecting a child's `exact`) instead of the first
  // prefix match, so a route nested under a sibling's href (e.g.
  // /ventes/journalieres under /ventes) never borrows that sibling's label.
  const currentLabel = getNavigationPageLabel(pathname, currentUser?.role);
  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <header className="sticky top-0 z-30 hidden border-b border-white/60 bg-[color:rgb(244_248_252_/_0.82)] backdrop-blur-xl lg:block">
      <div className="page-shell flex min-h-[104px] items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow">Workspace</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
            <h1 className="font-heading text-[1.8rem] font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-[2.3rem]">
              {currentLabel}
            </h1>
            <p className="text-sm capitalize text-[var(--text-secondary)]" suppressHydrationWarning>
              {today}
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-3 lg:flex">
          <UserMenu
            userName={currentUser?.nom ?? "Utilisateur"}
            userRole={currentUser?.role ?? "admin"}
            userEmail={currentUser?.email ?? ""}
          />
        </div>
      </div>
    </header>
  );
}
