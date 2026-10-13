"use client";

import { usePathname } from "next/navigation";

import { AssistantLauncherButton } from "@/components/assistant/assistant-panel";
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
          {/* Title on its own line, the date right under it (same sizes and
              colours as before). leading-tight keeps the date close to the
              title; a long title wraps inside this flexible column, never
              under the assistant / profile block on the right. */}
          <div className="mt-2 flex min-w-0 flex-col gap-1">
            <h1 className="font-heading text-[1.8rem] leading-tight font-semibold tracking-[-0.04em] break-words text-[var(--text-primary)] sm:text-[2.3rem]">
              {currentLabel}
            </h1>
            <p className="text-sm capitalize text-[var(--text-secondary)]" suppressHydrationWarning>
              {today}
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-3 lg:flex">
          <AssistantLauncherButton />
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
