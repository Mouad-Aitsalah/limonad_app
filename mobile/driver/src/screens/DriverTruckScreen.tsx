import * as React from "react";
import { ArrowLeft } from "lucide-react";

import { DriverHomeView } from "@/components/driver/driver-home-view";
import { NetworkStatusBadge } from "@/components/driver-pos/network-status-badge";
import type { DriverOfflineContext, NetworkState } from "@/lib/offline/driver-pos";
import type { TruckDto } from "@/types/operations-dto";

import { loadShellDriverTruck } from "../lib/driver-truck-data-source";
import type { Screen } from "../navigation";

// Same href -> Screen mapping DriverHomeScreen/DriverLauncherScreen use for
// DriverHomeView's own quick links ("/driver" itself is this screen).
const HREF_TO_SCREEN: Record<string, Screen> = {
  "/driver/stock": "STOCK",
  "/driver/ventes": "VENTES",
  "/driver/pos": "POS",
  "/driver/clients": "CLIENTS",
  "/driver/tournee": "TOURNEE",
};

type DriverTruckScreenProps = {
  token: string | null;
  offlineContext: DriverOfflineContext;
  deviceOnline: boolean;
  onBack: () => void;
  onNavigate: (screen: Screen) => void;
};

type TruckState =
  | { kind: "loading" }
  | { kind: "ready"; truck: TruckDto | null; source: "server" | "cache" }
  | { kind: "error"; message: string };

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 27: renders the SAME "Mon
 * camion" the web app shows (/driver/camion redirects to /driver - see
 * app/driver/camion/page.tsx - i.e. DriverHomeView, whose first block is
 * DriverTruckCard) instead of the shell's own MigrationPendingScreen
 * placeholder. DriverHomeView itself is unchanged; like DriverStockScreen,
 * this screen owns the online/offline resolution (loadShellDriverTruck) and
 * hands the resolved TruckDto down as a plain prop.
 */
export function DriverTruckScreen({
  token,
  offlineContext,
  deviceOnline,
  onBack,
  onNavigate,
}: DriverTruckScreenProps) {
  const [state, setState] = React.useState<TruckState>({ kind: "loading" });

  // deviceOnline is a dependency on purpose: reconnecting while this screen is
  // open re-runs the online fetch, which also refreshes cached_truck.
  React.useEffect(() => {
    let active = true;
    setState((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
    loadShellDriverTruck({ token, offlineContext }).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { kind: "ready", truck: result.truck, source: result.source }
          : { kind: "error", message: result.message },
      );
    });
    return () => {
      active = false;
    };
  }, [token, offlineContext, deviceOnline]);

  function handleNavigate(href: string) {
    const target = HREF_TO_SCREEN[href];
    if (target) onNavigate(target);
  }

  const networkState: NetworkState =
    !deviceOnline
      ? "OFFLINE"
      : state.kind === "ready" && state.source === "server"
        ? "ONLINE"
        : state.kind === "loading"
          ? "ONLINE"
          : "SERVER_UNREACHABLE";

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Accueil
        </button>
        <div className="ml-auto">
          <NetworkStatusBadge networkState={networkState} />
        </div>
      </header>

      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {state.kind === "loading" ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Chargement du camion...</p>
        ) : state.kind === "error" ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{state.message}</p>
        ) : (
          <DriverHomeView truck={state.truck} onNavigate={handleNavigate} />
        )}
      </div>
    </div>
  );
}
