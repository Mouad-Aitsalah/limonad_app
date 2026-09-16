import * as React from "react";

import { getCachedCustomers, getOfflineSales } from "@/lib/offline/driver-pos";
import type { DriverOfflineContext, OfflineSaleWithLines, SyncStatus } from "@/lib/offline/driver-pos";

import { styles } from "../ui/styles";

type OfflineSalesScreenProps = {
  context: DriverOfflineContext;
  onBack: () => void;
};

const STATUS_LABEL: Partial<Record<SyncStatus, string>> = {
  PENDING_SYNC: "En attente",
  SYNCING: "Synchronisation...",
  SYNCED: "Synchronisee",
  SYNC_ERROR: "Erreur de synchronisation",
  REQUIRES_REVIEW: "A verifier",
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; sales: OfflineSaleWithLines[]; customerNames: Map<string, string> };

/**
 * PHASE 5A.2 - "16. VENTES OFFLINE ÉCRAN SIMPLE". SQLite only, zero fetch -
 * reuses getOfflineSales/getCachedCustomers unchanged (same module the
 * already-validated driver POS uses), never the Next app's
 * OfflineSalesDialog component (that one imports shadcn/ui components tied
 * to the Next app's own build, not portable to this Vite shell).
 */
export function OfflineSalesScreen({ context, onBack }: OfflineSalesScreenProps) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  React.useEffect(() => {
    let active = true;
    const scope = { organizationId: context.organizationId, driverId: context.driverId };
    Promise.all([getOfflineSales(scope), getCachedCustomers(scope)]).then(([sales, customers]) => {
      if (!active) return;
      const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
      setState({ status: "ready", sales, customerNames });
    });
    return () => {
      active = false;
    };
  }, [context.organizationId, context.driverId]);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Ventes hors connexion</h1>
      </header>

      <section style={styles.card}>
        {state.status === "loading" ? <p style={styles.muted}>Lecture de la base locale...</p> : null}
        {state.status === "ready" && state.sales.length === 0 ? (
          <p style={styles.muted}>Aucune vente hors connexion enregistree sur cet appareil.</p>
        ) : null}
        {state.status === "ready" && state.sales.length > 0
          ? state.sales.map((sale) => (
              <div key={sale.localId} style={styles.saleRow}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  {/* CORRECTION - "15. HISTORIQUE": la meme ligne locale
                      passe de la reference OFF-... a l'officialDisplayNumber
                      une fois SYNCED (markOfflineSaleSynced ecrit dans la
                      meme ligne SQLite) - jamais une deuxieme ligne. */}
                  <span style={{ fontWeight: 600 }}>
                    {sale.syncStatus === "SYNCED" && sale.officialDisplayNumber
                      ? sale.officialDisplayNumber
                      : sale.localReference}
                  </span>
                  <span style={{ fontWeight: 600 }}>{sale.totalTTC.toFixed(2)} DH</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b" }}>
                  <span>
                    {formatTime(sale.soldAt)} - {sale.customerId ? (state.customerNames.get(sale.customerId) ?? "Client") : "Client comptoir"}
                  </span>
                  <span>
                    {sale.syncStatus === "SYNCED" ? "✓ " : sale.syncStatus === "PENDING_SYNC" ? "⏳ " : ""}
                    {STATUS_LABEL[sale.syncStatus] ?? sale.syncStatus}
                  </span>
                </div>
              </div>
            ))
          : null}
      </section>

      <button type="button" style={styles.secondaryButton} onClick={onBack}>
        Retour
      </button>
    </main>
  );
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
