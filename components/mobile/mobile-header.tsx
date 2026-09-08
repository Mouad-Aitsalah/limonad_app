"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { getNavigationPageLabel } from "@/components/layout/navigation";
import { MobileBackLink } from "@/components/mobile/mobile-back-link";

export function MobileHeader() {
  const pathname = usePathname();
  const { currentUser } = useAuth();

  return (
    <header className="mobile-safe-top sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl lg:hidden">
      <div className="mobile-safe-x flex min-h-16 items-center gap-3 px-4 py-2">
        <MobileBackLink />
        <p className="min-w-0 flex-1 text-base font-semibold leading-snug text-foreground">
          {getNavigationPageLabel(pathname, currentUser?.role)}
        </p>
      </div>
    </header>
  );
}
