"use client";

import { ShieldCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";

export function DriverHeader() {
  const { currentUser } = useAuth();
  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <header className="sticky top-0 z-30 hidden border-b border-white/60 bg-[color:rgb(244_248_252_/_0.88)] backdrop-blur-xl lg:block">
      <div className="flex min-h-[84px] items-center gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow">Driver Space</p>
          <p className="mt-2 truncate font-heading text-xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
            Bonjour, {currentUser?.nom ?? ""}
          </p>
          <p className="mt-1 text-xs capitalize text-[var(--text-secondary)]" suppressHydrationWarning>
            {today}
          </p>
        </div>

        <div className="surface-card-muted flex items-center gap-2 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          <ShieldCheck className="h-4 w-4 text-[var(--primary)]" />
          Mobile ready
        </div>
      </div>
    </header>
  );
}
