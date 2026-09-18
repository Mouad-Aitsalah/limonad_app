import * as React from "react";
import { ArrowLeft } from "lucide-react";

import {
  DriverStockUnavailable,
  DriverStockView,
  type DriverStockViewStock,
} from "@/components/driver-stock/driver-stock-view";
import { NetworkStatusBadge } from "@/components/driver-pos/network-status-badge";
import type { DriverOfflineContext, NetworkState } from "@/lib/offline/driver-pos";

import { loadShellDriverStock } from "../lib/driver-stock-data-source";

type DriverStockScreenProps = {
  token: string | null;
  offlineContext: DriverOfflineContext;
  deviceOnline: boolean;
  onBack: () => void;
};

type StockState =
  | { kind: "loading" }
  | { kind: "ready"; stock: DriverStockViewStock; source: "server" | "cache" }
  | { kind: "error"; message: string };

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 23: renders the SAME "Mon
 * stock" the web app shows at /driver/stock (DriverStockView, unchanged
 * except for its narrowed prop type - see that component's own doc comment)
 * instead of the shell's own MigrationPendingScreen placeholder.
 *
 * Unlike DriverClientsView/DriverPosView, DriverStockView has no internal
 * data-fetching hook of its own (no "use client", no hooks at all - a pure
 * {stock} in, JSX out component) - this screen owns the online/offline
 * resolution itself (loadShellDriverStock) and passes the resolved snapshot
 * down as a plain prop.
 */
export function DriverStockScreen({ token, offlineContext, deviceOnline, onBack }: DriverStockScreenProps) {
  const [state, setState] = React.useState<StockState>({ kind: "loading" });

  React.useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    loadShellDriverStock({ token, offlineContext }).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { kind: "ready", stock: result.stock, source: result.source }
          : { kind: "error", message: result.message },
      );
    });
    return () => {
      active = false;
    };
  }, [token, offlineContext]);

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
          <p className="py-16 text-center text-sm text-muted-foreground">Chargement du stock...</p>
        ) : state.kind === "error" ? (
          <DriverStockUnavailable message={state.message} />
        ) : (
          <DriverStockView stock={state.stock} />
        )}
      </div>
    </div>
  );
}
