"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** The sections of Paramètres (admin only, like their pages - see nav-items.ts). */
export const SETTINGS_SECTIONS = [
  { label: "Identité de l'entreprise", href: "/parametres/identite" },
  { label: "Tarification", href: "/parametres/tarification" },
] as const;

/**
 * Sub-navigation shared by the Paramètres pages: the same look as the app's
 * line tabs (rounded bar, white active entry), but real links - each section
 * is its own route, reachable from here and from the sidebar.
 */
export function SettingsNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Sections des paramètres"
      className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-border bg-muted/30 p-1"
    >
      {SETTINGS_SECTIONS.map((section) => {
        const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20",
              active
                ? "bg-white text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                : "text-foreground/60 hover:text-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
