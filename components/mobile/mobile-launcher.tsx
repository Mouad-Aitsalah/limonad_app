"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp, ArrowUpRight, BookOpen, ChevronDown, FileClock, FileText,
  LayoutGrid, LogOut, MapPinned, ReceiptText, Settings, ShoppingBag, Truck,
  UserRound, Users, type LucideIcon,
} from "lucide-react";

import { getNavigationLinks } from "@/components/layout/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { DESKTOP_MEDIA_QUERY } from "@/lib/auth/browser-home-route";
import { getDefaultRouteForRole } from "@/lib/auth/default-route";
import { roleLabels } from "@/lib/roles";
import { cn } from "@/lib/utils";

type TileAppearance = { label?: string; icon?: LucideIcon; order?: number };

// Presentation only: entries never grant access or create links. Every tile
// comes from getNavigationLinks, the same filtered navigation as desktop.
const appearance: Record<string, TileAppearance> = {
  "/organisations": { order: 0 },
  "/dashboard": { order: 0 },
  "/pos": { label: "POS", order: 1 },
  "/ventes": { label: "Factures", icon: ReceiptText, order: 2 },
  "/produits": { order: 3 },
  "/stock": { order: 4 },
  "/achats": { label: "Achats", icon: ShoppingBag, order: 5 },
  "/comptes": { label: "Clients", icon: Users, order: 6 },
  "/comptabilite/journal": { label: "Compta", icon: BookOpen, order: 7 },
  "/employes": { order: 8 },
  "/avoirs": { label: "Avoirs", icon: FileText, order: 9 },
  "/chargements": { icon: Truck, order: 10 },
  "/utilisateurs": { label: "Administration", icon: Settings, order: 11 },
  "/pos/versements": { icon: ArrowDownUp },
  "/achats/nouveau": { label: "Nouvel achat" },
  "/employes/avances-salaire": { label: "Salaires" },
  "/comptabilite/ecritures": { label: "Écritures", icon: FileClock },
  "/comptabilite/reglements-clients": { label: "Règlements" },
  "/comptabilite/comptes": { label: "Plan comptable" },
  "/comptabilite/parametres": { label: "Réglages compta" },
  "/driver/tournee": { label: "Tournée / GPS", icon: MapPinned, order: 0 },
  "/driver/pos": { label: "POS", order: 1 },
  "/driver/stock": { label: "Stock camion", order: 2 },
  "/driver/clients": { label: "Clients", order: 3 },
  "/driver/ventes": { label: "Ventes", icon: ReceiptText, order: 4 },
  "/driver": { label: "Mon camion", icon: Truck, order: 5 },
};

// Indexed by the tile's `order` (see `appearance`): 0 Dashboard, 1 POS,
// 2 Factures, 3 Produits, 4 Stock, 5 Achats, 6 Clients, 7 Compta,
// 8 Employés, 9 Avoirs, 10 Chargements, 11 Administration. Additional
// tiles (no `order`) fall back to their list index and wrap around.
// Presentation only - never affects which tiles a role can see.
const tileColors = [
  "from-[#0F4FA8] to-[#2E6AC6]", // bleu foncé
  "from-[#00A67A] to-[#10C193]", // vert / turquoise
  "from-[#2496E8] to-[#52AEF0]", // bleu clair
  "from-[#FF7A00] to-[#FF9836]", // orange
  "from-[#7489A5] to-[#90A3BC]", // gris bleu
  "from-[#EC168C] to-[#F646A9]", // rose / magenta
  "from-[#E71919] to-[#F04444]", // rouge
  "from-[#10B8AD] to-[#38D0C6]", // turquoise clair
  "from-[#2496E8] to-[#52AEF0]", // bleu clair
  "from-[#FF7A00] to-[#FF9836]", // orange
  "from-[#7489A5] to-[#90A3BC]", // gris bleu
  "from-[#B332BA] to-[#C95FCE]", // violet / magenta
];

type LauncherLink = ReturnType<typeof getNavigationLinks>[number];

function TileGrid({ items }: { items: LauncherLink[] }) {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:gap-x-6 sm:gap-y-7">
      {items.map((item, index) => {
        const design = appearance[item.href];
        const Icon = design?.icon ?? item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            title={item.label}
            aria-label={item.label}
            className="group flex min-w-0 touch-manipulation flex-col items-center gap-2 rounded-2xl px-1 py-1 text-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <span className={cn(
              "flex size-[4.25rem] items-center justify-center rounded-[22px] bg-linear-to-br text-white shadow-[0_6px_14px_rgba(16,32,56,0.13)] ring-1 ring-black/5 transition-transform group-hover:-translate-y-0.5 group-active:scale-95 motion-reduce:transition-none sm:size-20 sm:rounded-3xl",
              tileColors[(design?.order ?? index) % tileColors.length],
            )}>
              <Icon aria-hidden="true" strokeWidth={1.7} className="size-7 sm:size-8" />
            </span>
            <span className="w-full break-words text-xs font-medium leading-4 text-foreground sm:text-sm sm:leading-5">
              {design?.label ?? item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function MobileLauncher() {
  const { currentUser, logout } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    if (!currentUser) return;
    const desktop = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const returnToDesktop = () => {
      if (desktop.matches) router.replace(getDefaultRouteForRole(currentUser.role));
    };
    returnToDesktop();
    desktop.addEventListener("change", returnToDesktop);
    return () => desktop.removeEventListener("change", returnToDesktop);
  }, [currentUser, router]);

  if (!currentUser) return null;

  const links = getNavigationLinks(currentUser.role);
  const featured = links.filter((item) => appearance[item.href]?.order !== undefined)
    .sort((a, b) => appearance[a.href].order! - appearance[b.href].order!);
  const additional = links.filter((item) => appearance[item.href]?.order === undefined);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
      router.replace("/login");
    } catch {
      setLogoutError("Déconnexion impossible. Veuillez réessayer.");
      setLoggingOut(false);
    }
  }

  return (
    <main className="mobile-workspace mobile-safe-top mobile-safe-bottom mobile-safe-x mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-linear-to-b from-[#e6f0f6] via-[#eef4f9] to-[#eef4f9] px-5 lg:hidden">
      <header className="flex items-center justify-between gap-3 pt-7 pb-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-linear-to-br from-[#173156] to-[#0f7a5d] text-lg font-bold text-white shadow-sm" aria-hidden="true">C</span>
          <p className="text-[11px] font-bold tracking-[0.16em] text-[#173156]">COMDIS MANAGER</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white bg-white/80 text-[#173156] shadow-sm focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="Profil"
          >
            <UserRound aria-hidden="true" className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
            >
              <LogOut aria-hidden="true" />
              {loggingOut ? "Déconnexion…" : "Se déconnecter"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="pb-4">
        <span className="inline-flex rounded-full border border-emerald-200/70 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">{roleLabels[currentUser.role]}</span>
      </div>

      <nav aria-label="Applications" className="pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mes applications</h2>
          <LayoutGrid aria-hidden="true" className="size-4 text-muted-foreground/70" />
        </div>
        <TileGrid items={featured} />
        {additional.length > 0 && (
          <details className="group/tools mt-7 border-t border-border/70 pt-2">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
              Toutes les applications
              <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open/tools:rotate-180" />
            </summary>
            <div className="pt-3"><TileGrid items={additional} /></div>
          </details>
        )}
      </nav>

      <footer className="mt-auto border-t border-border/70 pt-3 pb-5">
        <button type="button" onClick={() => void handleLogout()} disabled={loggingOut} className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl text-sm font-medium text-muted-foreground hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
          <LogOut aria-hidden="true" className="size-4" />
          {loggingOut ? "Déconnexion…" : "Se déconnecter"}
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </button>
        {logoutError && <p role="alert" className="text-center text-sm text-destructive">{logoutError}</p>}
      </footer>
    </main>
  );
}
