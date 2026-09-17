import * as React from "react";
import { ArrowLeft } from "lucide-react";

import { DriverClientsView } from "@/components/driver-clients/driver-clients-view";
import { NetworkStatusBadge } from "@/components/driver-pos/network-status-badge";
import type { DriverOfflineContext, NetworkState } from "@/lib/offline/driver-pos";

import { createShellCustomersPageFetcher } from "../lib/driver-clients-data-source";
import { refreshFullDriverCustomerCache } from "../lib/driver-pos-data-source";

type DriverClientsScreenProps = {
  token: string | null;
  offlineContext: DriverOfflineContext;
  deviceOnline: boolean;
  onBack: () => void;
  onCreateSale: (customerId: string) => void;
};

const MANAGE_CUSTOMERS_UNAVAILABLE_MESSAGE =
  "Créer ou modifier un client n'est pas encore disponible sur cette version de l'application.";

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 21: renders the SAME "Mes
 * clients" the web app shows at /driver/clients (DriverClientsView,
 * generalized the same way DriverPosView already was) instead of the
 * shell's own MigrationPendingScreen placeholder for this entry.
 *
 * Refreshes the FULL customer cache (refreshFullDriverCustomerCache -
 * driver-pos-data-source.ts, unchanged, the exact same function/cache
 * PosScreen's own effect already uses) on every mount when online, so this
 * screen never depends on the driver having opened POS first to have a
 * complete offline customer list later - see Étape 21's own "PHASE 13. TEST
 * OFFLINE" requirement ("le cache doit être le cache complet ... pas limité
 * aux 20 premières suggestions").
 *
 * Create/edit ("Nouveau client"/"Modifier"/"Ajouter la localisation") is
 * deliberately disabled here (disableCustomerManagement) - see driver-
 * clients-view.tsx's own doc comment on that prop for exactly why (no
 * Bearer/CORS path on POST /api/driver/customers yet, no GPS runtime in this
 * shell) - consultation/recherche only for this étape.
 */
export function DriverClientsScreen({
  token,
  offlineContext,
  deviceOnline,
  onBack,
  onCreateSale,
}: DriverClientsScreenProps) {
  const [serverReachable, setServerReachable] = React.useState(deviceOnline);

  React.useEffect(() => {
    if (!deviceOnline || !token) return;
    let active = true;
    refreshFullDriverCustomerCache({
      token,
      organizationId: offlineContext.organizationId,
      driverId: offlineContext.driverId,
    }).then((result) => {
      if (!active) return;
      setServerReachable(result !== null);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh once per mount, matching PosScreen's own full-customer-cache effect
  }, []);

  const fetchCustomersPage = React.useMemo(
    () =>
      createShellCustomersPageFetcher({
        token,
        organizationId: offlineContext.organizationId,
        driverId: offlineContext.driverId,
      }),
    [token, offlineContext.organizationId, offlineContext.driverId],
  );

  const networkState: NetworkState = !deviceOnline ? "OFFLINE" : serverReachable ? "ONLINE" : "SERVER_UNREACHABLE";

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
        <DriverClientsView
          fetchCustomersPage={fetchCustomersPage}
          onCreateSale={onCreateSale}
          disableCustomerManagement={MANAGE_CUSTOMERS_UNAVAILABLE_MESSAGE}
        />
      </div>
    </div>
  );
}
