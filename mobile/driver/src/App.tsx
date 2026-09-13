import * as React from "react";

import { getAnyDriverOfflineContext, isNetworkAvailable } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext } from "@/lib/offline/driver-pos";

import { API_BASE_URL } from "./lib/api-base";
import {
  loginMobile,
  logoutMobile,
  testAuthenticatedDriverApi,
  type AuthenticatedApiTestResult,
  type MobileUser,
} from "./lib/mobile-auth";

/**
 * PHASE 5A.1 - "11. MINI SHELL". Deliberately minimal: no POS, no ventes
 * screen yet (see the task's own "NE PAS ENCORE INTÉGRER LE POS COMPLET").
 * Proves three things end to end: (1) the shell starts and reads SQLite
 * with zero network calls, (2) a Bearer token obtained from
 * /api/mobile/auth/login actually authenticates against an existing
 * /api/driver/* route, (3) no token / a wrong token is rejected.
 */

type ContextState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; context: DriverOfflineContext };

export function App() {
  const [online, setOnline] = React.useState<boolean>(isNetworkAvailable());
  const [contextState, setContextState] = React.useState<ContextState>({ status: "loading" });

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loginPending, setLoginPending] = React.useState(false);
  // PHASE 5A.1 - "7. TOKEN STORAGE": in-memory ONLY for this POC. Never
  // localStorage/SQLite/a file - lost on reload/kill by design, see this
  // task's own report item 9/10.
  const [accessToken, setAccessToken] = React.useState<string | null>(null);
  const [user, setUser] = React.useState<MobileUser | null>(null);

  const [apiTest, setApiTest] = React.useState<
    { label: string; pending: boolean; result: AuthenticatedApiTestResult | { error: string } | null }
  >({ label: "", pending: false, result: null });

  // Manual re-trigger (the "Lire donnees offline" button) - fine to setState
  // synchronously here, since it only ever runs from a click handler.
  const refreshOfflineContext = React.useCallback(async () => {
    setContextState({ status: "loading" });
    const context = await getAnyDriverOfflineContext();
    setContextState(context ? { status: "ready", context } : { status: "empty" });
  }, []);

  React.useEffect(() => {
    // Initial state is already { status: "loading" } (see useState above) -
    // no synchronous setState call is needed directly in the effect body
    // (matches hooks/use-auth.tsx's own mount-effect pattern: a plain
    // .then() continuation, never an eagerly-invoked async callback).
    let active = true;
    getAnyDriverOfflineContext().then((context) => {
      if (!active) return;
      setContextState(context ? { status: "ready", context } : { status: "empty" });
    });

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoginError(null);
    setLoginPending(true);
    try {
      const result = await loginMobile(email.trim(), password);
      if (!result.success) {
        setLoginError(result.message);
        return;
      }
      setAccessToken(result.accessToken);
      setUser(result.user);
      setPassword("");
    } finally {
      setLoginPending(false);
    }
  }

  async function handleLogout() {
    if (accessToken) await logoutMobile(accessToken);
    setAccessToken(null);
    setUser(null);
    setApiTest({ label: "", pending: false, result: null });
  }

  async function runApiTest(label: string, token: string | null) {
    setApiTest({ label, pending: true, result: null });
    try {
      const result = await testAuthenticatedDriverApi(token);
      setApiTest({ label, pending: false, result });
    } catch (error) {
      setApiTest({
        label,
        pending: false,
        result: { error: error instanceof Error ? error.message : "Erreur reseau." },
      });
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>COMDIS Driver</h1>
        <span style={{ ...styles.badge, ...(online ? styles.badgeOnline : styles.badgeOffline) }}>
          {online ? "Connecte" : "Hors connexion"}
        </span>
      </header>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Dernier contexte</h2>
        {contextState.status === "loading" ? <p style={styles.muted}>Lecture de la base locale...</p> : null}
        {contextState.status === "empty" ? (
          <p style={styles.muted}>
            Aucune donnee hors connexion disponible.
            <br />
            Connectez-vous une premiere fois.
          </p>
        ) : null}
        {contextState.status === "ready" ? (
          <dl style={styles.definitionList}>
            <Row label="Chauffeur" value={contextState.context.driverName} />
            <Row label="Camion" value={contextState.context.truckName ?? "-"} />
            <Row label="Organisation" value={contextState.context.organizationName ?? "-"} />
            <Row label="Derniere synchro" value={formatDate(contextState.context.syncedAt)} />
          </dl>
        ) : null}
        <button type="button" style={styles.secondaryButton} onClick={() => void refreshOfflineContext()}>
          Lire donnees offline
        </button>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Authentification mobile</h2>
        {!accessToken ? (
          <form onSubmit={handleLogin} style={styles.form}>
            <input
              style={styles.input}
              type="email"
              placeholder="Email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Mot de passe"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button type="submit" style={styles.primaryButton} disabled={loginPending}>
              {loginPending ? "Connexion..." : "Se connecter"}
            </button>
            {loginError ? <p style={styles.error}>{loginError}</p> : null}
          </form>
        ) : (
          <div>
            <p style={styles.muted}>
              Connecte en tant que <strong>{user?.role}</strong> (token en memoire uniquement).
            </p>
            <button type="button" style={styles.secondaryButton} onClick={() => void handleLogout()}>
              Se deconnecter
            </button>
          </div>
        )}
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Tester API authentifiee</h2>
        <p style={styles.muted}>Cible : {API_BASE_URL}/api/driver/pos</p>
        <div style={styles.buttonRow}>
          <button
            type="button"
            style={styles.primaryButton}
            disabled={!accessToken || apiTest.pending}
            onClick={() => void runApiTest("avec token", accessToken)}
          >
            Avec token
          </button>
          <button
            type="button"
            style={styles.secondaryButton}
            disabled={apiTest.pending}
            onClick={() => void runApiTest("sans token", null)}
          >
            Sans token
          </button>
          <button
            type="button"
            style={styles.secondaryButton}
            disabled={apiTest.pending}
            onClick={() => void runApiTest("faux token", "faux-token-de-test")}
          >
            Faux token
          </button>
        </div>
        {apiTest.pending ? <p style={styles.muted}>Appel en cours ({apiTest.label})...</p> : null}
        {apiTest.result ? (
          <pre style={styles.pre}>
            {apiTest.label ? `[${apiTest.label}]\n` : ""}
            {JSON.stringify(apiTest.result, null, 2)}
          </pre>
        ) : null}
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.row}>
      <dt style={styles.rowLabel}>{label}</dt>
      <dd style={styles.rowValue}>{value}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: 480,
    margin: "0 auto",
    padding: "24px 16px 48px",
    color: "#0f172a",
    background: "#f8fafc",
    minHeight: "100vh",
    boxSizing: "border-box",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  badge: { fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999 },
  badgeOnline: { background: "#dcfce7", color: "#166534" },
  badgeOffline: { background: "#fef3c7", color: "#92400e" },
  card: {
    background: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
  },
  cardTitle: { fontSize: 14, fontWeight: 600, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 0.4 },
  muted: { fontSize: 13, color: "#64748b", margin: "0 0 8px" },
  definitionList: { margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", justifyContent: "space-between", fontSize: 14 },
  rowLabel: { color: "#64748b" },
  rowValue: { fontWeight: 600, textAlign: "right" },
  form: { display: "flex", flexDirection: "column", gap: 8 },
  input: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    fontSize: 14,
  },
  primaryButton: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  buttonRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  error: { color: "#b91c1c", fontSize: 13, margin: 0 },
  pre: {
    background: "#0f172a",
    color: "#e2e8f0",
    fontSize: 11,
    padding: 12,
    borderRadius: 10,
    overflowX: "auto",
    margin: 0,
  },
};
