import * as React from "react";

import { DriverHomeView } from "@/components/driver/driver-home-view";
import { NetworkStatusBadge } from "@/components/driver-pos/network-status-badge";
import type { NetworkState } from "@/lib/offline/driver-pos";
import type { TruckDto } from "@/types/operations-dto";

import type { BootState } from "../lib/auth-state";
import { mobileFetch } from "../lib/mobile-fetch";
import type { Screen } from "../navigation";

/**
 * ÉTAPE 19 - "4. NAVIGATION ANDROID": maps a driverNavItems href to this
 * shell's own Screen union - the one place that mapping lives, so
 * DriverHomeView itself (shared with the web) never needs to know the shell
 * has no router.
 */
const HREF_TO_SCREEN: Record<string, Screen> = {
  "/driver/stock": "STOCK",
  "/driver/ventes": "VENTES",
  "/driver/pos": "POS",
  "/driver/clients": "CLIENTS",
  "/driver/tournee": "TOURNEE",
};

type DriverHomeScreenProps = {
  bootState: Extract<BootState, { kind: "AUTHENTICATED" | "OFFLINE_CONTEXT_ONLY" }>;
  online: boolean;
  token: string | null;
  onNavigate: (screen: Screen) => void;
  onLogout: () => void;
  logoutPending: boolean;
};

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 19: renders the SAME
 * Accueil the web app shows at /driver (DriverHomeView, extracted verbatim
 * from app/driver/page.tsx - see that component's own doc comment) instead
 * of the shell's own hand-built HomeScreen.tsx (kept, unused - see this
 * task's own "12. NE PAS SUPPRIMER").
 *
 * `truck` has no offline equivalent yet: offline_context only ever carries a
 * flattened truckName string (see lib/offline/driver-pos/types.ts's
 * DriverOfflineContext), never the full TruckDto (registration/brand/model/
 * capacity/depot/status) DriverTruckCard needs - documented gap, not filled
 * here (no SQLite schema change). Fetched online-only via the new
 * GET /api/driver/truck; stays null offline, which DriverTruckCard already
 * renders as "Aucun camion affecté" - its own existing behavior, never
 * modified here.
 */
export function DriverHomeScreen({
  bootState,
  online,
  token,
  onNavigate,
  onLogout,
  logoutPending,
}: DriverHomeScreenProps) {
  const [truck, setTruck] = React.useState<TruckDto | null>(null);
  // "24. FAUX ONLINE" - same correction PosScreen's own markReachable already
  // applies: only a genuine network_error means the server truly wasn't
  // reached, never a plain absence of a truck.
  const [serverReachable, setServerReachable] = React.useState(online);

  React.useEffect(() => {
    if (!online || !token) return;
    let active = true;
    mobileFetch<{ truck: TruckDto | null }>("/api/driver/truck", token).then((outcome) => {
      if (!active) return;
      if (outcome.kind === "ok") {
        setTruck(outcome.data.truck);
      }
      setServerReachable(outcome.kind !== "network_error");
    });
    return () => {
      active = false;
    };
  }, [online, token]);

  const networkState: NetworkState = !online ? "OFFLINE" : serverReachable ? "ONLINE" : "SERVER_UNREACHABLE";

  function handleNavigate(href: string) {
    const target = HREF_TO_SCREEN[href];
    if (target) onNavigate(target);
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h1 className="flex-1 truncate font-heading text-lg font-semibold text-foreground">Accueil</h1>
        <NetworkStatusBadge networkState={networkState} />
        <button
          type="button"
          onClick={onLogout}
          disabled={logoutPending}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {logoutPending ? "..." : "Deconnexion"}
        </button>
      </header>

      {bootState.kind === "OFFLINE_CONTEXT_ONLY" ? (
        <p className="mx-4 mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Mode hors connexion - donnees du dernier chauffeur enregistre sur cet appareil.
        </p>
      ) : null}

      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <DriverHomeView truck={truck} onNavigate={handleNavigate} />
      </div>
    </div>
  );
}
