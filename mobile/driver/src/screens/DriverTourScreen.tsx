import * as React from "react";
import { ArrowLeft } from "lucide-react";

import { DriverTourView } from "@/components/driver-tour/driver-tour-view";
import { NetworkStatusBadge } from "@/components/driver-pos/network-status-badge";
import { toast } from "sonner";

import { MOBILE_HOME_ROUTE } from "@/lib/auth/browser-home-route";
import { getCachedDriverTour } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext, NetworkState } from "@/lib/offline/driver-pos";
import type { CurrentDriverTourDto } from "@/types/operations-dto";

import { createShellQuickCustomerCreator } from "../lib/driver-customer-api";
import { loadShellDriverTour } from "../lib/driver-tour-data-source";
import { returnShellDriverTour } from "../lib/driver-tour-actions";
import { DriverTourRuntimeProvider } from "../lib/driver-tour-runtime";
import { onDriverOfflineSyncCompleted } from "../lib/driver-offline-events";

type DriverTourScreenProps = {
  token: string | null;
  offlineContext: DriverOfflineContext;
  deviceOnline: boolean;
  onBack: () => void;
};

type TourState =
  | { kind: "loading" }
  | { kind: "ready"; tour: CurrentDriverTourDto; source: "server" | "cache"; syncedAt: string | null }
  | { kind: "error"; message: string };

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 28B: renders the SAME "Ma
 * tournee" the web app shows at /driver/tournee (DriverTourView, unchanged
 * except for its optional `readOnly` prop - see that component's own doc
 * comment) instead of the shell's MigrationPendingScreen placeholder. READ-
 * ONLY: it displays the existing tour returned by GET /api/driver/tour (Bearer)
 * and nothing else - no start/return/arrive/no-sale, no GPS, no map (their own
 * later étapes).
 *
 * Like DriverStockScreen, this screen owns the loading itself
 * (loadShellDriverTour) and hands the resolved DTO down as a plain prop;
 * DriverTourView reads the rest through DriverTourRuntimeProvider, the shell's
 * minimal stand-in for the historical runtime provider.
 */
export function DriverTourScreen({ token, offlineContext, deviceOnline, onBack }: DriverTourScreenProps) {
  const [state, setState] = React.useState<TourState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  // deviceOnline is a dependency on purpose: reconnecting while this screen is
  // open re-runs the load. A previously displayed tour stays on screen (no
  // flash back to "loading") until the fresh answer replaces it.
  React.useEffect(() => {
    let active = true;
    setState((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
    loadShellDriverTour({ token, offlineContext, deviceOnline }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setState({ kind: "ready", tour: result.tour, source: result.source, syncedAt: result.syncedAt });
        return;
      }
      // A refresh that fails while a tour is already shown keeps showing it.
      setState((previous) => (previous.kind === "ready" ? previous : { kind: "error", message: result.message }));
    });
    return () => {
      active = false;
    };
  }, [token, offlineContext, deviceOnline, attempt]);

  React.useEffect(() => {
    return onDriverOfflineSyncCompleted((detail) => {
      if (detail.syncedCount === 0) return;
      void getCachedDriverTour({
        organizationId: offlineContext.organizationId,
        driverId: offlineContext.driverId,
      }).then((cached) => {
        if (cached) setState({ kind: "ready", tour: cached.tour, source: "cache", syncedAt: cached.syncedAt });
      });
    });
  }, [offlineContext]);

  // The historical view has no "offline data" indicator of its own (and must
  // stay untouched), so tell the driver once when what is shown is the copy
  // saved on this device rather than a fresh answer.
  const cachedSyncedAt = state.kind === "ready" && state.source === "cache" ? (state.syncedAt ?? "") : null;
  React.useEffect(() => {
    if (cachedSyncedAt === null) return;
    const when = cachedSyncedAt ? new Date(cachedSyncedAt) : null;
    const time = when && !Number.isNaN(when.getTime())
      ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(when)
      : null;
    toast.info(time ? `Donnees hors connexion du ${time}.` : "Donnees hors connexion.");
  }, [cachedSyncedAt]);

  // DriverTourView's own header ends in MobileBackLink, a plain
  // <a href="/mobile"> on this shell (no router - see next-link.tsx) that
  // would navigate the WebView away from the app. Captured here and turned
  // into the shell's own "back to Accueil" instead, so the historical
  // component stays untouched.
  function interceptBackLink(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as Element | null;
    if (target?.closest(`a[href="${MOBILE_HOME_ROUTE}"]`)) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    }
  }

  // "Ajouter un client" on the map opens the compact name + GPS modal
  // (QuickAddCustomerDialog, inside DriverTourView); this is only its Bearer
  // transport - the full "Mes clients" form is a different screen.
  const createQuickCustomer = React.useMemo(() => createShellQuickCustomerCreator(token), [token]);

  const returnTour = React.useCallback(async () => {
    if (state.kind !== "ready") throw new Error("La tournee est encore en chargement.");
    const result = await returnShellDriverTour({
      token,
      offlineContext,
      currentTour: state.tour,
      deviceOnline,
    });
    setState({
      kind: "ready",
      tour: result.currentTour,
      source: result.mode === "offline" ? "cache" : "server",
      syncedAt: result.mode === "offline" ? null : new Date().toISOString(),
    });
    return result;
  }, [deviceOnline, offlineContext, state, token]);

  if (state.kind === "ready") {
    return (
      <div onClickCapture={interceptBackLink}>
        <DriverTourRuntimeProvider token={token} deviceOnline={deviceOnline}>
          <DriverTourView
            currentTour={state.tour}
            readOnly
            createQuickCustomer={createQuickCustomer}
            returnTour={returnTour}
          />
        </DriverTourRuntimeProvider>
      </div>
    );
  }

  const networkState: NetworkState = !deviceOnline ? "OFFLINE" : state.kind === "loading" ? "ONLINE" : "SERVER_UNREACHABLE";

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
          <p className="py-16 text-center text-sm text-muted-foreground">Chargement de la tournee...</p>
        ) : (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="mt-4 inline-flex h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Reessayer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
