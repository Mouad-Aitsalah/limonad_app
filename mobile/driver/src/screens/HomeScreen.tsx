import type { DriverOfflineContext } from "@/lib/offline/driver-pos";

import type { BootState } from "../lib/auth-state";
import type { Screen } from "../navigation";
import { styles, statusDotColor } from "../ui/styles";

type HomeScreenProps = {
  bootState: Extract<BootState, { kind: "AUTHENTICATED" | "OFFLINE_CONTEXT_ONLY" }>;
  online: boolean;
  context: DriverOfflineContext;
  onNavigate: (screen: Screen) => void;
  onLogout: () => void;
  logoutPending: boolean;
};

/**
 * PHASE 5A.2 - "11. ACCUEIL CHAUFFEUR LOCAL" / "12. ACTIONS ACCUEIL". The
 * real local home screen - every field comes from the already-loaded
 * offline_context (SQLite, no fetch). Visible in BOTH AUTHENTICATED and
 * OFFLINE_CONTEXT_ONLY (device-bound V1 assumption - see this task's own
 * "14. OFFLINE SANS TOKEN": a dedicated-driver phone may show its last known
 * context and let the driver keep working while offline).
 */
export function HomeScreen({ bootState, online, context, onNavigate, onLogout, logoutPending }: HomeScreenProps) {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>COMDIS Driver</h1>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: statusDotColor(online),
              display: "inline-block",
            }}
          />
          <span style={{ ...styles.badge, ...(online ? styles.badgeOnline : styles.badgeOffline) }}>
            {online ? "Connecte" : "Hors connexion"}
          </span>
        </span>
      </header>

      {bootState.kind === "OFFLINE_CONTEXT_ONLY" ? (
        <p style={{ ...styles.banner, ...styles.bannerInfo }}>
          Mode hors connexion - donnees du dernier chauffeur enregistre sur cet appareil.
        </p>
      ) : null}

      <section style={styles.card}>
        <dl style={styles.definitionList}>
          <Row label="Chauffeur" value={context.driverName} />
          {/* CORRECTION CONTEXTE OFFLINE - "5./6." a bare "-" is ambiguous
              (no data yet vs. genuinely none). truckName/tourCode are null
              exactly when getDriverPosContext's own response said so (no
              truck assigned / no IN_PROGRESS tour) - refreshed on every
              successful online boot/login (see refresh-offline-context.ts),
              so by the time this renders offline it is a real, current
              answer, not a stale guess. */}
          <Row label="Camion" value={context.truckName ?? "Non assigne"} />
          <Row label="Organisation" value={context.organizationName ?? "-"} />
          <Row label="Tournee" value={context.tourCode ?? "Aucune tournee active"} />
          <Row label="Derniere synchronisation" value={formatDate(context.syncedAt)} />
        </dl>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        <button type="button" style={styles.actionButton} onClick={() => onNavigate("POS")}>
          Point de vente
        </button>
        <button type="button" style={styles.actionButton} onClick={() => onNavigate("OFFLINE_SALES")}>
          Ventes hors connexion
        </button>
      </section>

      <button type="button" style={styles.secondaryButton} onClick={onLogout} disabled={logoutPending}>
        {logoutPending ? "Deconnexion..." : "Se deconnecter"}
      </button>
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
