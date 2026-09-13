import * as React from "react";

import type { BootState } from "../lib/auth-state";
import { loginMobile, type MobileUser } from "../lib/mobile-auth";
import { styles } from "../ui/styles";

type LoginScreenProps = {
  bootState: Extract<BootState, { kind: "LOGIN_REQUIRED" | "SESSION_EXPIRED" }>;
  online: boolean;
  onLoginSuccess: (token: string, user: MobileUser) => void;
};

/**
 * PHASE 5A.2 - "13. LOGIN UI". Only ever shown when bootState is
 * LOGIN_REQUIRED or SESSION_EXPIRED - both mean "online, no usable token".
 * The form is disabled while offline (a login attempt can never succeed
 * without a network round trip - "14. OFFLINE SANS TOKEN" explicitly warns
 * against presenting offline context access as a real authentication, and
 * the mirror of that is: never pretend a login button works without
 * Internet either).
 */
export function LoginScreen({ bootState, online, onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await loginMobile(email.trim(), password);
      if (!result.success) {
        setError(result.message);
        return;
      }
      // Never keep the password around one instant longer than needed.
      setPassword("");
      onLoginSuccess(result.accessToken, result.user);
    } finally {
      setPending(false);
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>COMDIS Driver</h1>
      </header>

      <section style={styles.card}>
        {bootState.kind === "SESSION_EXPIRED" ? (
          <p style={{ ...styles.banner, ...styles.bannerWarning }}>
            Session expiree. Reconnectez-vous.
          </p>
        ) : null}
        {!online ? (
          <p style={{ ...styles.banner, ...styles.bannerInfo }}>
            Hors connexion - la connexion necessite Internet.
          </p>
        ) : null}

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={!online || pending}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Mot de passe"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={!online || pending}
            required
          />
          <button type="submit" style={styles.primaryButton} disabled={!online || pending}>
            {pending ? "Connexion..." : "Se connecter"}
          </button>
          {error ? <p style={styles.error}>{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
