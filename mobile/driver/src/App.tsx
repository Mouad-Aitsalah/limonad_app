import * as React from "react";
import { Toaster } from "sonner";

import { configureNativeMediaAuth } from "@/lib/native-media-auth";
import { getAnyDriverOfflineContext, isNetworkAvailable } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";
import type { DriverPosContextDto } from "@/types/operations-dto";

import { API_BASE_URL } from "./lib/api-base";
import { deriveRestingBootState, runBootSequence, type BootState } from "./lib/auth-state";
import { syncPendingDriverSalesForShell } from "./lib/driver-pos-data-source";
import { syncPendingDriverTourReturnsForShell } from "./lib/driver-tour-sync";
import { DriverGpsRuntime } from "./lib/driver-gps-runtime";
import { logoutMobile, type MobileUser } from "./lib/mobile-auth";
import { bootstrapOfflineData, type OfflineBootstrapError } from "./lib/offline-bootstrap";
import { refreshOfflineContextFromServer } from "./lib/refresh-offline-context";
import { getMobileProfile, type StoredMobileProfile } from "./lib/secure-token-storage";
import type { Screen } from "./navigation";
import { DriverClientsScreen } from "./screens/DriverClientsScreen";
import { DriverLauncherScreen } from "./screens/DriverLauncherScreen";
import { DriverSalesScreen } from "./screens/DriverSalesScreen";
import { DriverStockScreen } from "./screens/DriverStockScreen";
import { DriverTourScreen } from "./screens/DriverTourScreen";
import { DriverTruckScreen } from "./screens/DriverTruckScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { OfflineSalesScreen } from "./screens/OfflineSalesScreen";
import { PosScreen } from "./screens/PosScreen";
import { styles } from "./ui/styles";

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
  // ÉTAPE OFFLINE-BOOTSTRAP - preparing this device's offline data (after a
  // login, or when a valid token finds no offline_context). While "running" the
  // UI shows a loading state, never the "no offline data" message; a failure is
  // latched in "error" (with a classified message + Retry/Logout) so nothing
  // loops and nothing fails silently.
  const [bootstrap, setBootstrap] = React.useState<OfflineBootstrapState>({ kind: "idle" });
  const [booted, setBooted] = React.useState(false);
  const profileRef = React.useRef<StoredMobileProfile | null>(null);
  const preloadedPosRef = React.useRef<DriverPosContextDto | null>(null);
  const bootstrapInFlightRef = React.useRef(false);

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

  // FIX ANDROID POS PHOTOS - components/products/product-media.tsx (shared
  // with the web app) reads this to fetch /api/products/[id]/image itself,
  // Bearer-authenticated, only when Capacitor.isNativePlatform() - see
  // lib/native-media-auth.ts's own doc comment for why a plain <img> cannot
  // do this on Android. Kept in sync with the same token every other shell
  // fetch already uses (mobile-fetch.ts) - never a separate auth source.
  React.useEffect(() => {
    configureNativeMediaAuth({ apiBaseUrl: API_BASE_URL, token });
  }, [token]);

  // "8. RESTAURATION AU DÉMARRAGE" - the ONE place a network call may run
  // automatically, and only when a stored token exists and the device
  // reports itself online (see runBootSequence). Runs exactly once.
  React.useEffect(() => {
    let active = true;
    (async () => {
      const context = await getAnyDriverOfflineContext();
      if (!active) return;
      setOfflineContext(context);
      profileRef.current = await getMobileProfile();

      const result = await runBootSequence({ online: isNetworkAvailable(), context });
      if (!active) return;
      // A valid token with NO offline context: keep the POS context the boot
      // check just fetched so the rebuild below does not repeat the call.
      if (result.token && result.driverPosContext && !context) {
        preloadedPosRef.current = result.driverPosContext;
      }
      setToken(result.token);
      updateBootState(result.bootState);
      hasBootedRef.current = true;
      setBooted(true);

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
    void syncPendingDriverTourReturnsForShell(offlineContext, token);
  }, [online, token, offlineContext]);

  const runBootstrapOnce = React.useCallback(async (authToken: string) => {
    setBootstrap({ kind: "running" });
    const profile = profileRef.current ?? (await getMobileProfile());
    if (!profile) {
      // Token from an older install that never stored the login profile: the
      // user/org ids cannot be invented - a fresh login is the honest way out.
      setBootstrap({
        kind: "error",
        error: {
          stage: "profile",
          kind: "no_driver_profile",
          status: null,
          message: "Profil utilisateur introuvable sur cet appareil. Deconnectez-vous puis reconnectez-vous.",
        },
      });
      return;
    }
    profileRef.current = profile;
    const preloaded = preloadedPosRef.current;
    preloadedPosRef.current = null;
    const result = await bootstrapOfflineData({ token: authToken, profile, preloadedPosContext: preloaded });
    if (!result.ok) {
      setBootstrap({ kind: "error", error: result.error });
      return;
    }
    setOfflineContext(result.context);
    setBootstrap({ kind: "idle" });
    setScreen("HOME");
  }, []);

  const runBootstrap = React.useCallback(async (authToken: string) => {
    // Single-flight: a double tap on Retry / a re-fired effect never starts two runs.
    if (bootstrapInFlightRef.current) return;
    bootstrapInFlightRef.current = true;
    try {
      await runBootstrapOnce(authToken);
    } finally {
      bootstrapInFlightRef.current = false;
    }
  }, [runBootstrapOnce]);

  // Rebuilds the offline data whenever the device is online with a valid
  // token but has none (relaunch after an interrupted/failed first login, or
  // coming back online after starting offline without a cache). Never runs
  // with an existing context (normal/offline start untouched), and never
  // re-runs after a failure (bootstrap.kind stays "error" until Retry).
  React.useEffect(() => {
    if (!booted || !token || !online || offlineContext || bootstrap.kind !== "idle") return;
    queueMicrotask(() => void runBootstrap(token));
  }, [booted, token, online, offlineContext, bootstrap.kind, runBootstrap]);

  async function handleLoginSuccess(newToken: string, newUser: MobileUser) {
    if (import.meta.env.DEV) console.log("[OFFLINE BOOT] login success");
    profileRef.current = {
      id: newUser.id,
      nom: newUser.nom,
      organizationId: newUser.organizationId ?? null,
      driverId: newUser.driverId ?? null,
    };
    preloadedPosRef.current = null;
    // Loading state FIRST, then the token: the token flips the auth state to
    // AUTHENTICATED, and that must never be visible without offline data.
    setBootstrap({ kind: "running" });
    setToken(newToken);
    await runBootstrap(newToken);
  }

  async function handleLogout() {
    setLogoutPending(true);
    try {
      await logoutMobile(token);
    } finally {
      setToken(null);
      setBootstrap({ kind: "idle" });
      profileRef.current = null;
      preloadedPosRef.current = null;
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

  if (bootstrap.kind === "running") {
    return <OfflineBootstrapView />;
  }

  if (bootstrap.kind === "error") {
    return (
      <NoLocalDataView
        error={bootstrap.error}
        online={online}
        logoutPending={logoutPending}
        onRetry={() => token && void runBootstrap(token)}
        onLogout={() => void handleLogout()}
      />
    );
  }

  if (bootState.kind === "LOGIN_REQUIRED" || bootState.kind === "SESSION_EXPIRED") {
    return <LoginScreen bootState={bootState} online={online} onLoginSuccess={handleLoginSuccess} />;
  }

  if (bootState.kind === "NO_OFFLINE_DATA" || !offlineContext) {
    // Online with a token: the effect above is about to (re)build the data -
    // show progress, not a dead-end message.
    if (token && online) return <OfflineBootstrapView />;
    return (
      <NoLocalDataView
        error={null}
        online={online}
        logoutPending={logoutPending}
        onRetry={() => token && void runBootstrap(token)}
        onLogout={() => void handleLogout()}
      />
    );
  }

  // By elimination, bootState is now AUTHENTICATED or OFFLINE_CONTEXT_ONLY,
  // and offlineContext is non-null - exactly what HomeScreen/OfflineSalesScreen need.
  return (
    <>
      <Toaster position="top-center" richColors />
      <DriverGpsRuntime token={token} online={online}>
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
          case "CLIENTS":
            return (
              <DriverClientsScreen
                token={token}
                offlineContext={offlineContext}
                deviceOnline={online}
                onBack={() => setScreen("HOME")}
                onCreateSale={() => setScreen("POS")}
              />
            );
          case "STOCK":
            return (
              <DriverStockScreen
                token={token}
                offlineContext={offlineContext}
                deviceOnline={online}
                onBack={() => setScreen("HOME")}
              />
            );
          case "VENTES":
            return (
              <DriverSalesScreen
                token={token}
                offlineContext={offlineContext}
                deviceOnline={online}
                onBack={() => setScreen("HOME")}
              />
            );
          // ÉTAPE 28B/28C - "Ma tournee": the historical DriverTourView, READ-ONLY
          // (no start/return/GPS/map yet), loaded over Bearer and cached in SQLite.
          case "TOURNEE":
            return (
              <DriverTourScreen
                token={token}
                offlineContext={offlineContext}
                deviceOnline={online}
                onBack={() => setScreen("HOME")}
              />
            );
          // ÉTAPE 27 - "Mon camion": the historical /driver page (DriverHomeView
          // + DriverTruckCard), online via GET /api/driver/truck, offline via
          // the cached_truck table.
          case "CAMION":
            return (
              <DriverTruckScreen
                token={token}
                offlineContext={offlineContext}
                deviceOnline={online}
                onBack={() => setScreen("HOME")}
                onNavigate={setScreen}
              />
            );
          default:
            return (
              <DriverLauncherScreen
                onNavigate={setScreen}
                onLogout={() => void handleLogout()}
              />
            );
        }
      })()}
      </DriverGpsRuntime>
    </>
  );
}

type OfflineBootstrapState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; error: OfflineBootstrapError };

/** Shown while the offline data is being prepared - a normal step, not an error. */
function OfflineBootstrapView() {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>COMDIS Driver</h1>
      </header>
      <section style={styles.card}>
        <p style={{ ...styles.muted, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
          <span
            aria-hidden="true"
            className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          Preparation des donnees hors connexion...
        </p>
      </section>
    </main>
  );
}

/**
 * "15. PREMIER LANCEMENT SANS CACHE" - a valid session on a device that has no
 * offline data (yet). Never a crash, never an infinite spinner, never a dead
 * end: it says why (the classified bootstrap error, or "offline") and always
 * offers Retry (needs Internet) and Logout (back to the login screen).
 */
function NoLocalDataView({
  error,
  online,
  logoutPending,
  onRetry,
  onLogout,
}: {
  error: OfflineBootstrapError | null;
  online: boolean;
  logoutPending: boolean;
  onRetry: () => void;
  onLogout: () => void;
}) {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>COMDIS Driver</h1>
      </header>
      <section style={styles.card}>
        <p style={styles.cardTitle}>Donnees hors connexion indisponibles</p>
        <p style={styles.muted}>
          {error
            ? error.message
            : "Aucune donnee hors connexion n'est disponible sur cet appareil. Connectez-vous a Internet pour les preparer."}
        </p>
        <div style={styles.buttonRow}>
          <button type="button" style={styles.primaryButton} onClick={onRetry} disabled={!online}>
            Reessayer
          </button>
          <button type="button" style={styles.secondaryButton} onClick={onLogout} disabled={logoutPending}>
            Se deconnecter
          </button>
        </div>
      </section>
    </main>
  );
}
