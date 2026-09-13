import * as React from "react";

import { getAnyDriverOfflineContext, isNetworkAvailable } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";

import { deriveRestingBootState, runBootSequence, type BootState } from "./lib/auth-state";
import { logoutMobile, type MobileUser } from "./lib/mobile-auth";
import { seedMinimalOfflineContextIfMissing } from "./lib/seed-offline-context";
import type { Screen } from "./navigation";
import { HomeScreen } from "./screens/HomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { OfflineSalesScreen } from "./screens/OfflineSalesScreen";
import { PosPlaceholderScreen } from "./screens/PosPlaceholderScreen";
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
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function handleLoginSuccess(newToken: string, newUser: MobileUser) {
    setToken(newToken);
    await seedMinimalOfflineContextIfMissing(newUser);
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
  switch (screen) {
    case "OFFLINE_SALES":
      return <OfflineSalesScreen context={offlineContext} onBack={() => setScreen("HOME")} />;
    case "POS_PLACEHOLDER":
      return <PosPlaceholderScreen onBack={() => setScreen("HOME")} />;
    default:
      return (
        <HomeScreen
          bootState={bootState}
          online={online}
          context={offlineContext}
          onNavigate={setScreen}
          onLogout={() => void handleLogout()}
          logoutPending={logoutPending}
        />
      );
  }
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
