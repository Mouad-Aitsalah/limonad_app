import * as React from "react";
import { Toaster } from "sonner";

import { driverNavItems } from "@/components/driver/driver-nav-items";
import { getAnyDriverOfflineContext, isNetworkAvailable } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";
import type { DriverPosContextDto } from "@/types/operations-dto";

import { deriveRestingBootState, runBootSequence, type BootState } from "./lib/auth-state";
import { syncPendingDriverSalesForShell } from "./lib/driver-pos-data-source";
import { mobileFetch } from "./lib/mobile-fetch";
import { logoutMobile, type MobileUser } from "./lib/mobile-auth";
import { refreshOfflineContextFromServer } from "./lib/refresh-offline-context";
import type { Screen } from "./navigation";
import { DriverHomeScreen } from "./screens/DriverHomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { MigrationPendingScreen } from "./screens/MigrationPendingScreen";
import { OfflineSalesScreen } from "./screens/OfflineSalesScreen";
import { PosScreen } from "./screens/PosScreen";
import { styles } from "./ui/styles";

// ÉTAPE 19 - "4. NAVIGATION ANDROID": one lookup, driverNavItems itself as
// the only source of truth for label/icon per historical route - never a
// second, hand-typed copy of those labels.
function navItemForHref(href: string) {
  const item = driverNavItems.find((candidate) => candidate.href === href);
  if (!item) throw new Error(`No driverNavItems entry for ${href}`);
  return item;
}

/**
 * PHASE 5A.2 - shell orchestrator: bootstraps (SQLite + secure token +
 * network) once at mount, keeps a five-state auth machine (see
 * lib/auth-state.ts) instead of a boolean, and drives a small local
 * navigation state machine (see navigation.ts) - no router, no navigation to
 * the Next app's own /driver/* routes.
 */
export function App() {
  const [online, setOnline] = React.useState<boolean>(isNetworkAvailable());
  const [offlineContext, setOfflineContext] = React.useState<DriverOfflineContext | null>(null);
  const [bootState, setBootState] = React.useState<BootState>({ kind: "BOOTING" });
  const [token, setToken] = React.useState<string | null>(null);
  const [screen, setScreen] = React.useState<Screen>("HOME");
  const [logoutPending, setLogoutPending] = React.useState(false);

  const hasBootedRef = React.useRef(false);
  // Kept in sync with bootState on every update (see updateBootState) so the
  // reactive effect below can inspect the CURRENT value without adding
  // bootState itself to its dependency array (which would risk a feedback
  // loop, since that same effect also calls setBootState).
  const bootStateRef = React.useRef<BootState>(bootState);

  function updateBootState(next: BootState) {
    bootStateRef.current = next;
    setBootState(next);
  }

  // "8. RESTAURATION AU DÉMARRAGE" - the ONE place a network call may run
  // automatically, and only when a stored token exists and the device
  // reports itself online (see runBootSequence). Runs exactly once.
  React.useEffect(() => {
    let active = true;
    (async () => {
      const context = await getAnyDriverOfflineContext();
      if (!active) return;
      setOfflineContext(context);

      const result = await runBootSequence({ online: isNetworkAvailable(), context });
      if (!active) return;
      setToken(result.token);
      updateBootState(result.bootState);
      hasBootedRef.current = true;

      // CORRECTION CONTEXTE OFFLINE - the boot-time restoration check above
      // already fetched a full DriverPosContextDto when it succeeded; reuse
      // it (no second fetch) to refresh offline_context with truck/tour/
      // stockLocationId. organizationId/userId/userName come from the
      // context ALREADY cached on this device (written by a prior login) -
      // if there is none yet (a token surviving with no local context at
      // all - see this task's own "9. ISOLATION"), this step is skipped;
      // the next real login will populate it via handleLoginSuccess below.
      if (result.driverPosContext && context && result.token) {
        await refreshOfflineContextFromServer({
          token: result.token,
          organizationId: context.organizationId,
          userId: context.userId,
          userName: context.userName,
          driverPosContext: result.driverPosContext,
        });
        if (!active) return;
        setOfflineContext(await getAnyDriverOfflineContext());
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Live online/offline transitions (and login/logout-driven token changes)
  // - a pure, no-network recomputation only (never re-verifies the token
  // over the network here - that stays a boot-time-only check, see above).
  React.useEffect(() => {
    if (!hasBootedRef.current) return;
    // A stored token was already proven invalid (401) at boot - never let an
    // unrelated online/offline flicker silently reinterpret that as a plain
    // LOGIN_REQUIRED and erase the "session expiree" messaging. A genuinely
    // NEW token (a fresh login) always takes precedence over this guard.
    if (bootStateRef.current.kind === "SESSION_EXPIRED" && !token) return;
    updateBootState(deriveRestingBootState(token, online, offlineContext));
  }, [online, token, offlineContext]);

  React.useEffect(() => {
    const handleOnline = () => {
      if (import.meta.env.DEV) console.log("[NETWORK ONLINE]");
      setOnline(true);
    };
    const handleOffline = () => {
      if (import.meta.env.DEV) console.log("[NETWORK OFFLINE]");
      setOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // CORRECTION "FINALISATION PIPELINE OFFLINE V1" - "8./9. SYNC AUTOMATIQUE":
  // fires on every OFFLINE->ONLINE transition (online flips true) AND once
  // at boot if the app starts already online with sales left over from a
  // previous session - both cases are just "online + token + a local context
  // are now all available", so ONE effect covers both without two separate
  // trigger paths to keep in sync. Safe to fire even with nothing pending or
  // while genuinely offline (a stale/optimistic `online` flag): syncPending-
  // DriverSalesForShell's own engine is single-flight (see sync-sales.ts)
  // and a no-op batch (nothing PENDING_SYNC/SYNC_ERROR) never touches the
  // network at all - so this can never create a duplicate sale, only, at
  // worst, attempt a sync that immediately no-ops or transiently fails.
  React.useEffect(() => {
    if (!online || !token || !offlineContext) return;
    void syncPendingDriverSalesForShell(
      { organizationId: offlineContext.organizationId, driverId: offlineContext.driverId },
      token,
    );
  }, [online, token, offlineContext]);

  async function handleLoginSuccess(newToken: string, newUser: MobileUser) {
    setToken(newToken);

    // CORRECTION CONTEXTE OFFLINE - fetch the SAME full context
    // (DriverPosContextDto) the web app's driver-pos page loads, then
    // hydrate offline_context from it via the shared, unchanged
    // hydrateDriverOfflineCache (see refresh-offline-context.ts). Requires
    // organizationId/driverId, which every real driver login response
    // carries; a role/account without them (see mobile-auth.ts's
    // MobileUser) simply has no offline context to build yet.
    if (newUser.organizationId && newUser.driverId) {
      const posOutcome = await mobileFetch<{ context: DriverPosContextDto }>("/api/driver/pos", newToken);
      if (posOutcome.kind === "ok") {
        await refreshOfflineContextFromServer({
          token: newToken,
          organizationId: newUser.organizationId,
          userId: newUser.id,
          userName: newUser.nom,
          driverPosContext: posOutcome.data.context,
        });
      }
    }

    setOfflineContext(await getAnyDriverOfflineContext());
    setScreen("HOME");
  }

  async function handleLogout() {
    setLogoutPending(true);
    try {
      await logoutMobile(token);
    } finally {
      setToken(null);
      setScreen("HOME");
      setLogoutPending(false);
    }
  }

  if (bootState.kind === "BOOTING") {
    return (
      <main style={styles.page}>
        <header style={styles.header}>
          <h1 style={styles.title}>COMDIS Driver</h1>
        </header>
        <p style={styles.muted}>Demarrage...</p>
      </main>
    );
  }

  if (bootState.kind === "LOGIN_REQUIRED" || bootState.kind === "SESSION_EXPIRED") {
    return <LoginScreen bootState={bootState} online={online} onLoginSuccess={handleLoginSuccess} />;
  }

  if (bootState.kind === "NO_OFFLINE_DATA" || !offlineContext) {
    return <NoLocalDataView authenticated={bootState.kind === "AUTHENTICATED"} />;
  }

  // By elimination, bootState is now AUTHENTICATED or OFFLINE_CONTEXT_ONLY,
  // and offlineContext is non-null - exactly what HomeScreen/OfflineSalesScreen need.
  return (
    <>
      <Toaster position="top-center" richColors />
      {(() => {
        switch (screen) {
          case "OFFLINE_SALES":
            return <OfflineSalesScreen context={offlineContext} onBack={() => setScreen("HOME")} />;
          case "POS":
            return (
              <PosScreen
                token={token}
                offlineContext={offlineContext}
                deviceOnline={online}
                onBack={() => setScreen("HOME")}
              />
            );
          case "STOCK":
          case "VENTES":
          case "CLIENTS":
          case "TOURNEE": {
            const href =
              screen === "STOCK"
                ? "/driver/stock"
                : screen === "VENTES"
                  ? "/driver/ventes"
                  : screen === "CLIENTS"
                    ? "/driver/clients"
                    : "/driver/tournee";
            const item = navItemForHref(href);
            return (
              <MigrationPendingScreen
                label={item.label}
                icon={item.icon}
                onBack={() => setScreen("HOME")}
              />
            );
          }
          default:
            return (
              <DriverHomeScreen
                bootState={bootState}
                online={online}
                token={token}
                onNavigate={setScreen}
                onLogout={() => void handleLogout()}
                logoutPending={logoutPending}
              />
            );
        }
      })()}
    </>
  );
}

/**
 * "15. PREMIER LANCEMENT SANS CACHE" - and its edge-case sibling: a fresh
 * login that succeeded (AUTHENTICATED) but this device still has no local
 * SQLite context (either a non-driver account, or SQLite itself unavailable
 * in this environment - see database.ts's own fail-soft design). Never a
 * crash, never an infinite spinner - always this one clear message.
 */
function NoLocalDataView({ authenticated }: { authenticated: boolean }) {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>COMDIS Driver</h1>
      </header>
      <section style={styles.card}>
        <p style={styles.muted}>
          {authenticated
            ? "Connecte, mais aucune donnee hors connexion n'est disponible sur cet appareil."
            : "Aucune donnee hors connexion disponible."}
          <br />
          {authenticated ? "Reessayez une fois la mise en cache disponible." : "Connectez-vous une premiere fois avec Internet."}
        </p>
      </section>
    </main>
  );
}
