import * as React from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  DriverPosView,
  type DriverPosCollectSale,
  type DriverPosCreateSale,
  type DriverPosCurrentUser,
  type DriverPosFetchPendingSales,
  type DriverPosRefreshContext,
  type DriverPosRuntime,
  type DriverPosSyncPendingSales,
} from "@/components/driver-pos/driver-pos-view";
import type { CustomerNumberResolver } from "@/components/pos/customer-number-input";
import type { CustomerSearchFn } from "@/components/pos/mobile-customer-picker";
import type { PosProductRemoteSearch } from "@/components/pos/use-pos-product-search";
import { customerAccountNumber } from "@/lib/customer-code";
import {
  getOfflineCacheDiagnostics,
  type DriverOfflineContext,
  type NetworkState,
} from "@/lib/offline/driver-pos";
import type { CustomerDto, DriverPosContextDto, DriverPosProductDto, SaleDto } from "@/types/operations-dto";

import { onDriverOfflineSyncCompleted } from "../lib/driver-offline-events";
import {
  loadShellDriverPosContext,
  refreshFullDriverCustomerCache,
  syncPendingDriverSalesForShell,
} from "../lib/driver-pos-data-source";
import { createShellQuickCustomerCreator } from "../lib/driver-customer-api";
import { apiUrl } from "../lib/api-base";
import { mobileFetch, type MobileFetchOutcome } from "../lib/mobile-fetch";
import { useOrganizationIdentity } from "../lib/organization-identity";
import { styles } from "../ui/styles";

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 8 - "BRANCHEMENT MINIMAL":
 * this screen no longer implements the POS itself (cart/products/customer/
 * payment/validate/print/WhatsApp/Factures du jour - all of that now lives
 * ONLY in components/driver-pos/driver-pos-view.tsx, byte-for-byte the same
 * component the web app renders). This file's remaining job is exactly what
 * ÉTAPE 8's own instructions describe: an adapter between the shell's own
 * boot/offline runtime (token, offlineContext, deviceOnline, the SQLite-
 * backed offline cache) and DriverPosView's injectable props - never a
 * second POS implementation.
 *
 * Reused UNCHANGED: loadShellDriverPosContext, refreshFullDriverCustomerCache,
 * syncPendingDriverSalesForShell, onDriverOfflineSyncCompleted (all
 * lib/offline/driver-pos-adjacent shell functions this screen or App.tsx
 * already called before this step), useOrganizationIdentity, mobileFetch.
 * DriverPosView's OWN offline-CASH path (createOfflineSale, SQLite, outbox)
 * is untouched and unforked - it already reads currentUser/identity/
 * networkState/driverRuntime from the props below, so it works correctly
 * here with zero extra wiring.
 *
 * ÉTAPE 9 - "FINALISER L'INTÉGRATION OFFLINE": closes the 3 gaps ÉTAPE 8's
 * own report flagged - DriverPosView's internal "Synchroniser"/reconnect-
 * sync and post-sale refreshContext() now use this screen's own Bearer
 * transports (syncPendingSales/refreshDriverContext below), and BUG-03
 * (offline ticket "OFF-..." upgrading to the real invoice number once its
 * sync completes) is wired via onSyncCompleted, reusing the shell's existing
 * `driver-offline-sync-completed` event bus - see each callback's own doc
 * comment below for exactly what it reuses vs. why.
 *
 * ÉTAPE 14 - "RAFRAÎCHISSEMENT UI APRÈS SYNC EXTERNE": a sync triggered from
 * App.tsx's own reconnect effect (not through DriverPosView's own
 * "Synchroniser" button) bypasses every one of this screen's 6 Bearer
 * adapters, so `serverReachable` was never corrected for it - see the new
 * onDriverOfflineSyncCompleted subscription below, a second independent
 * listener on the same already-existing event (never a second sync).
 */

type PosScreenProps = {
  token: string | null;
  offlineContext: DriverOfflineContext;
  deviceOnline: boolean;
  onBack: () => void;
};

const NOOP_DRIVER_RUNTIME: DriverPosRuntime = {
  // The shell has no GPS/tour-proximity feature wired into its POS screen
  // (that is the web-only nearby-customer suggestion - see driver-pos-view.
  // tsx's own DriverPosRuntime doc comment) - a no-op here is a faithful
  // "this surface doesn't exist in this shell", never a fabricated behavior.
  markCustomerHandled: () => {},
  refreshCurrentTour: async () => undefined,
};

export function PosScreen({ token, offlineContext, deviceOnline, onBack }: PosScreenProps) {
  const [context, setContext] = React.useState<DriverPosContextDto | null>(null);
  const [allCustomers, setAllCustomers] = React.useState<CustomerDto[]>([]);
  const [fullCustomersCached, setFullCustomersCached] = React.useState(false);
  const [contextError, setContextError] = React.useState<"NOT_FOUND" | "ERROR" | null>(null);
  // "24. FAUX ONLINE" (preserved from the previous fork - ÉTAPE 8C: "préserver
  // le comportement offline déjà validé"): corrected by actual mobileFetch
  // outcomes below - only a genuine network_error means the server truly
  // wasn't reached; ok/unauthorized/server_error all mean it was.
  const [serverReachable, setServerReachable] = React.useState(deviceOnline);
  const effectiveOnline = deviceOnline && serverReachable;
  const identity = useOrganizationIdentity(token);
  const createQuickCustomer = React.useMemo(
    () => createShellQuickCustomerCreator(token),
    [token],
  );

  // Light "site" theme (see .pos-light in styles.css) for the whole time the
  // POS is on screen. Also on <body>: the customer picker and the dialogs
  // render in portals, outside this screen's own wrapper, and must not fall
  // back to the app-wide bluish background. Purely visual.
  React.useEffect(() => {
    document.body.classList.add("pos-light");
    return () => document.body.classList.remove("pos-light");
  }, []);

  const markReachable = React.useCallback((kind: MobileFetchOutcome<unknown>["kind"]) => {
    setServerReachable(kind !== "network_error");
  }, []);

  // ÉTAPE 14 - "3. RECONNEXION": a sync batch can only ever complete
  // (successfully or not) if the device genuinely reached the server, so a
  // completed batch is itself proof of reachability - corrects the same
  // "24. FAUX ONLINE" state the 6 adapters above already correct, for the
  // one path that bypasses every one of them: a sync triggered from OUTSIDE
  // this screen (App.tsx's own reconnect effect calling
  // syncPendingDriverSalesForShell directly, never through createSale/
  // fetchPendingSales/collectSale/searchProductsRemote/searchCustomers/
  // resolveCustomerByNumber above). A SEPARATE subscription from
  // DriverPosView's own onSyncCompleted (passed as a prop below) - the
  // shared event bus is explicitly designed for multiple independent
  // listeners (see driver-offline-events.ts's own doc comment) - this one
  // only ever reads reachability, it never triggers a second sync.
  React.useEffect(() => {
    return onDriverOfflineSyncCompleted(() => {
      setServerReachable(true);
    });
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadShellDriverPosContext({
        token,
        organizationId: offlineContext.organizationId,
        organizationName: offlineContext.organizationName,
        userId: offlineContext.userId,
        userName: offlineContext.userName,
        driverId: offlineContext.driverId,
      });
      if (!active) return;
      if (!result.ok) {
        setContextError(result.reason);
        return;
      }
      setContextError(null);
      setContext(result.context);
      setAllCustomers(result.context.customers);
      if (result.source === "server") setServerReachable(true);
      else if (token) setServerReachable(false);

      if (import.meta.env.DEV) {
        void getOfflineCacheDiagnostics({
          organizationId: offlineContext.organizationId,
          driverId: offlineContext.driverId,
        }).then((diagnostics) => {
          if (active) console.log("[OFFLINE CACHE DIAGNOSTICS]", diagnostics);
        });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only, this screen no longer reloads context itself (DriverPosView owns every post-sale refresh internally)
  }, []);

  // CORRECTION "CACHE COMPLET CLIENTS CHAUFFEUR" (preserved from the previous
  // fork): GET /api/driver/pos's context.customers is a small, bounded
  // preload - fetch the driver's COMPLETE authorized list once online and
  // keep it in `allCustomers` for resolveCustomerByNumber's own local-first
  // lookup below (see that callback's own doc comment for why this keeps
  // mattering for the whole lifetime of this screen, unlike the one-shot
  // `initialContext` handed to DriverPosView).
  React.useEffect(() => {
    if (!effectiveOnline || !token || fullCustomersCached) return;
    let cancelled = false;
    void refreshFullDriverCustomerCache({
      token,
      organizationId: offlineContext.organizationId,
      driverId: offlineContext.driverId,
    }).then((fullList) => {
      if (cancelled || !fullList) return;
      setAllCustomers(fullList);
      setFullCustomersCached(true);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveOnline, token, fullCustomersCached, offlineContext.organizationId, offlineContext.driverId]);

  const networkState: NetworkState = !deviceOnline ? "OFFLINE" : serverReachable ? "ONLINE" : "SERVER_UNREACHABLE";

  const currentUser = React.useMemo<DriverPosCurrentUser>(
    () => ({ id: offlineContext.userId, organizationId: offlineContext.organizationId, nom: offlineContext.userName }),
    [offlineContext.userId, offlineContext.organizationId, offlineContext.userName],
  );

  // ÉTAPE 9 - "1. SYNC DES VENTES": DriverPosView's own "Synchroniser" button
  // and reconnect auto-trigger now call this instead of the shared engine
  // directly - reuses syncPendingDriverSalesForShell UNCHANGED (the exact
  // function App.tsx's own top-level auto-sync already calls), so there is
  // still only ONE sync engine (lib/offline/driver-pos/sync-sales.ts) and
  // only ONE Bearer transport for it, never a duplicate.
  const syncPendingSales = React.useCallback<DriverPosSyncPendingSales>(
    (scope) => syncPendingDriverSalesForShell(scope, token),
    [token],
  );

  // ÉTAPE 9 - "2. REFRESH CONTEXT": DriverPosView's own post-sale/online-
  // transition refresh now calls this instead of the web-only relative-fetch
  // reader - reuses loadShellDriverPosContext UNCHANGED (the same function
  // this screen's own boot load above already calls), so there is still only
  // ONE cache-reconstruction path (lib/offline/driver-pos/pos-context.ts).
  // Also keeps `allCustomers`/`serverReachable` current for
  // resolveCustomerByNumber/networkState, exactly like the boot load does.
  const refreshDriverContext = React.useCallback<DriverPosRefreshContext>(
    async (params) => {
      const result = await loadShellDriverPosContext({ ...params, token });
      if (!result.ok) return result;
      if (result.source === "server") setServerReachable(true);
      else if (token) setServerReachable(false);
      if (result.source === "cache" || !fullCustomersCached) {
        setAllCustomers(result.context.customers);
      }
      return result;
    },
    [token, fullCustomersCached],
  );

  const createSale = React.useCallback<DriverPosCreateSale>(
    async (input) => {
      if (!token) return { ok: false, message: "Session expiree. Reconnectez-vous." };
      const endpoint = "/api/driver/sales";
      console.log("[POS-CHECKOUT-DEBUG] BEFORE REQUEST", {
        url: apiUrl(endpoint),
        tourId: context?.tour?.id ?? null,
      });
      const outcome = await mobileFetch<{ sale?: SaleDto; message?: string }>(endpoint, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      console.log("[POS-CHECKOUT-DEBUG] RESPONSE", {
        status: "status" in outcome ? outcome.status : null,
        body: outcome,
      });
      markReachable(outcome.kind);
      if (outcome.kind === "ok" && outcome.data.sale) return { ok: true, sale: outcome.data.sale };
      if (outcome.kind === "unauthorized") return { ok: false, message: "Session expiree. Reconnectez-vous." };
      if (outcome.kind === "server_error" || outcome.kind === "network_error") {
        return { ok: false, message: outcome.message };
      }
      return { ok: false, message: "Reponse serveur incomplete." };
    },
    [context?.tour?.id, token, markReachable],
  );

  const fetchPendingSales = React.useCallback<DriverPosFetchPendingSales>(async () => {
    if (!token) return [];
    const outcome = await mobileFetch<{ sales?: SaleDto[] }>("/api/driver/sales/pending", token, {
      cache: "no-store",
    });
    markReachable(outcome.kind);
    return outcome.kind === "ok" ? (outcome.data.sales ?? []) : [];
  }, [token, markReachable]);

  const collectSale = React.useCallback<DriverPosCollectSale>(
    async ({ saleId, paymentMethod, paidAmount, bankAccountingAccountId }) => {
      if (!token) return { ok: false, message: "Session expiree. Reconnectez-vous." };
      const outcome = await mobileFetch<{ sale?: SaleDto; message?: string }>(
        `/api/driver/sales/${encodeURIComponent(saleId)}/collect`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentMethod,
            paidAmount,
            reference: null,
            ...(paymentMethod === "BANK_TRANSFER"
              ? { bankAccountingAccountId: bankAccountingAccountId ?? null }
              : {}),
          }),
        },
      );
      markReachable(outcome.kind);
      if (outcome.kind === "ok" && outcome.data.sale) return { ok: true, sale: outcome.data.sale };
      if (outcome.kind === "unauthorized") return { ok: false, message: "Session expiree. Reconnectez-vous." };
      if (outcome.kind === "server_error" || outcome.kind === "network_error") {
        return { ok: false, message: outcome.message };
      }
      return { ok: false, message: "Reponse serveur incomplete." };
    },
    [token, markReachable],
  );

  const searchProductsRemote = React.useCallback<PosProductRemoteSearch>(
    async ({ query, locationId, limit }) => {
      if (!token) return [];
      const params = new URLSearchParams({ q: query, locationId, limit: String(limit) });
      const outcome = await mobileFetch<{ products?: DriverPosProductDto[] }>(
        `/api/products/search?${params.toString()}`,
        token,
      );
      markReachable(outcome.kind);
      return outcome.kind === "ok" ? (outcome.data.products ?? []) : [];
    },
    [token, markReachable],
  );

  // ÉTAPE 8 - "6. RECHERCHE CLIENT": `null` while offline/no token (never
  // attempt the remote fetch at all - MobileCustomerPicker's own three-state
  // contract from ÉTAPE 6), otherwise a function that REJECTS on failure
  // (BUG-01's own fix - see CustomerSearchFn's doc comment in mobile-
  // customer-picker.tsx) so a failed/offline search falls back to filtering
  // DriverPosView's own `initialSuggestions` instead of showing nothing.
  const searchCustomers = React.useMemo<CustomerSearchFn | null>(() => {
    if (!effectiveOnline || !token) return null;
    return async (query: string) => {
      const outcome = await mobileFetch<{ customers?: CustomerDto[] }>(
        `/api/customers/search?q=${encodeURIComponent(query)}`,
        token,
      );
      markReachable(outcome.kind);
      if (outcome.kind !== "ok") throw new Error("La recherche client a echoue.");
      return outcome.data.customers ?? [];
    };
  }, [effectiveOnline, token, markReachable]);

  // ÉTAPE 8 - "9. N° CLIENT" (preserved from the previous fork's own BUG-05
  // fix): `allCustomers` (this screen's own complete, continuously-refreshed
  // cache - see the effect above) is checked FIRST, unconditionally - a
  // number already known on this device resolves instantly, online or
  // offline, with zero network wait. The server is only ever a fallback for
  // a genuine local cache miss, matching customer-number-input.tsx's own
  // CustomerNumberLookupResult contract (found/not_found/error).
  const resolveCustomerByNumber = React.useCallback<CustomerNumberResolver>(
    async (accountNumber) => {
      const trimmed = accountNumber.trim();
      const localMatch = allCustomers.find(
        (candidate) => customerAccountNumber(candidate.code) === trimmed,
      );
      if (localMatch) return { kind: "found", customer: localMatch };
      if (!effectiveOnline || !token) {
        return { kind: "not_found", message: "Client introuvable hors connexion." };
      }
      const outcome = await mobileFetch<{ customer?: CustomerDto; message?: string }>(
        `/api/customers/by-number?n=${encodeURIComponent(trimmed)}`,
        token,
        { cache: "no-store" },
      );
      markReachable(outcome.kind);
      if (outcome.kind === "ok" && outcome.data.customer) {
        return { kind: "found", customer: outcome.data.customer };
      }
      if (outcome.kind === "server_error") {
        return { kind: "not_found", message: outcome.message };
      }
      return { kind: "error" };
    },
    [allCustomers, effectiveOnline, token, markReachable],
  );

  // "17. PREMIER LANCEMENT SANS CACHE" (preserved): never an infinite
  // spinner - once loadShellDriverPosContext reports ok:false (no server AND
  // no cache), this must win over the loading state below.
  if (contextError) {
    return (
      <main style={styles.page}>
        <BackHeader onBack={onBack} />
        <p style={styles.muted}>Donnees indisponibles. Connectez-vous une premiere fois a Internet.</p>
      </main>
    );
  }

  if (!context) {
    return (
      <main style={styles.page}>
        <BackHeader onBack={onBack} />
        <p style={styles.muted}>Chargement du point de vente...</p>
      </main>
    );
  }

  // POS != tournee: a stale server/cache flag must not block checkout after a
  // tour is closed. Only an empty product catalogue is a real POS blocker.
  if (!context.canSell && context.products.length === 0) {
    return (
      <main style={styles.page}>
        <BackHeader onBack={onBack} />
        <Card className="rounded-3xl">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground/40" />
            <p className="max-w-md text-sm text-muted-foreground">{context.message ?? "La vente est impossible."}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="pos-light min-h-dvh bg-background pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      {/* Same mobile header as the web driver shell (components/mobile/
          mobile-header.tsx + mobile-back-link.tsx): round back button + page
          title. DriverPosView's own back link is desktop-only (lg:inline-flex)
          so the phone needs this one; on the web the shell's <Link> does it,
          here it is the shell's own onBack. Network badge, pending-sales
          badge, sync button, last-sync time and print button are rendered by
          DriverPosView itself. */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="flex min-h-16 items-center gap-3 px-4 py-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour a l'accueil"
            className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-2xl border border-border/70 bg-white text-foreground shadow-sm transition-colors hover:bg-accent/40"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
          <p className="min-w-0 flex-1 text-base font-semibold leading-snug text-foreground">Point de vente</p>
        </div>
      </header>

      <div className="px-4 py-5">
      <DriverPosView
        initialContext={context}
        currentUser={currentUser}
        identity={identity}
        networkState={networkState}
        driverRuntime={NOOP_DRIVER_RUNTIME}
        createSale={createSale}
        fetchPendingSales={fetchPendingSales}
        collectSale={collectSale}
        syncPendingSales={syncPendingSales}
        refreshDriverContext={refreshDriverContext}
        onSyncCompleted={onDriverOfflineSyncCompleted}
        searchProductsRemote={searchProductsRemote}
        searchCustomers={searchCustomers}
        showCustomerAccountNumberInTrigger
        resolveCustomerByNumber={resolveCustomerByNumber}
        showResolvedCustomerConfirmation
        createQuickCustomer={createQuickCustomer}
      />
      </div>
    </div>
  );
}

function BackHeader({ onBack }: { onBack: () => void }) {
  return (
    <header style={styles.header}>
      <h1 style={styles.title}>Point de vente</h1>
      <button type="button" style={styles.secondaryButton} onClick={onBack}>
        Retour
      </button>
    </header>
  );
}
