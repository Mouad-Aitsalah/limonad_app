import * as React from "react";
import { ArrowLeft } from "lucide-react";

import { DriverSalesView } from "@/components/driver-pos/driver-sales-view";
import { NetworkStatusBadge } from "@/components/driver-pos/network-status-badge";
import type { DriverOfflineContext, NetworkState } from "@/lib/offline/driver-pos";
import type { DriverTodaySalesDto } from "@/types/operations-dto";

import { onDriverOfflineSyncCompleted } from "../lib/driver-offline-events";
import {
  createShellFetchCustomers,
  createShellFetchSaleDetail,
  getTodayOfflineSales,
  loadShellDriverSalesToday,
} from "../lib/driver-sales-data-source";
import { useOrganizationIdentity } from "../lib/organization-identity";

type DriverSalesScreenProps = {
  token: string | null;
  offlineContext: DriverOfflineContext;
  deviceOnline: boolean;
  onBack: () => void;
};

type SalesState =
  | { kind: "loading" }
  | { kind: "ready"; data: DriverTodaySalesDto; source: "server" | "cache" }
  | { kind: "error"; message: string };

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 25: renders the SAME "Mes
 * ventes" the web app shows at /driver/ventes (DriverSalesView, unchanged
 * except for its ÉTAPE 25 optional props - see that component's own doc
 * comment) instead of the shell's own MigrationPendingScreen placeholder.
 *
 * Like DriverStockScreen, this screen owns the online/offline resolution
 * itself (loadShellDriverSalesToday) and passes the resolved snapshot down
 * as a plain prop - DriverSalesView has no data-fetching hook of its own
 * for `data`.
 *
 * ÉTAPE 25G - "FUSION ONLINE/OFFLINE": `fetchOfflineSales` is only
 * overridden when the resolved data came from the local cache (source =
 * "cache", whether from a genuine offline device or just a transient
 * server hiccup while online - either way `data.sales` is empty in that
 * case, so nothing to double-count). When the data came from the server
 * (source = "server"), the prop is left undefined so DriverSalesView's own
 * default behavior runs unchanged (PENDING_SYNC-only, today - the exact
 * historical web merge, which already can't collide with `data.sales`
 * since a SYNCED sale is never PENDING_SYNC).
 */
export function DriverSalesScreen({ token, offlineContext, deviceOnline, onBack }: DriverSalesScreenProps) {
  const [state, setState] = React.useState<SalesState>({ kind: "loading" });
  const identity = useOrganizationIdentity(token);

  const load = React.useCallback(() => {
    loadShellDriverSalesToday({ token, offlineContext }).then((result) => {
      setState(
        result.ok
          ? { kind: "ready", data: result.data, source: result.source }
          : { kind: "error", message: result.message },
      );
    });
  }, [token, offlineContext]);

  React.useEffect(() => {
    setState({ kind: "loading" });
    load();
  }, [load]);

  // ÉTAPE 25H - "SYNCHRONISATION": refresh on the existing
  // driver-offline-sync-completed event (manual OR automatic sync, both go
  // through the same engine - see driver-offline-events.ts's own doc
  // comment) so a PENDING_SYNC sale's row updates to SYNCED/
  // officialDisplayNumber live, without leaving/reopening this screen and
  // without any polling.
  React.useEffect(() => onDriverOfflineSyncCompleted(() => load()), [load]);

  const fetchCustomers = React.useMemo(
    () => createShellFetchCustomers({ token, offlineContext }),
    [token, offlineContext],
  );
  const fetchSaleDetail = React.useMemo(() => createShellFetchSaleDetail(token), [token]);
  const fetchOfflineSales = React.useMemo(() => {
    if (state.kind !== "ready" || state.source === "server") return undefined;
    return () => getTodayOfflineSales(offlineContext).then((result) => result.sales);
  }, [state, offlineContext]);

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
          <p className="py-16 text-center text-sm text-muted-foreground">Chargement des ventes...</p>
        ) : state.kind === "error" ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{state.message}</p>
        ) : (
          <DriverSalesView
            data={state.data}
            currentUser={{ organizationId: offlineContext.organizationId, driverId: offlineContext.driverId }}
            identity={identity}
            fetchCustomers={fetchCustomers}
            fetchSaleDetail={fetchSaleDetail}
            fetchOfflineSales={fetchOfflineSales}
          />
        )}
      </div>
    </div>
  );
}
