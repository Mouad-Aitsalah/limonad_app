import type { GpsSyncState } from "./driver-tour-runtime";

const LABELS: Record<GpsSyncState, string> = {
  IDLE: "Position en attente",
  SENDING: "Envoi de la position...",
  SYNCED: "Position synchronisee",
  OFFLINE: "Hors connexion - envoi suspendu",
  ERROR: "Erreur d'envoi de la position",
  REJECTED: "Position refusee par le serveur",
  UNAUTHORIZED: "Session expiree - reconnectez-vous",
};

/**
 * ÉTAPE 28E - the one small addition to the historical tour screen: how the
 * last GPS fix fared on its way to the server (the historical header badge only
 * shows the GPS's own state). Not a new screen - a discreet pill, shown only
 * while a tour is in progress.
 */
export function GpsSyncPill({ state, deviceOnline }: { state: GpsSyncState; deviceOnline: boolean }) {
  // Offline is the device's live state; a stale OFFLINE label from before the
  // network came back reads as "waiting" until the next send confirms or fails.
  const effective: GpsSyncState = !deviceOnline ? "OFFLINE" : state === "OFFLINE" ? "IDLE" : state;
  const tone =
    effective === "SYNCED"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : effective === "ERROR" || effective === "REJECTED" || effective === "UNAUTHORIZED"
        ? "bg-red-50 text-red-700 border-red-200"
        : effective === "OFFLINE"
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : "bg-background text-muted-foreground border-border";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-4 z-40 rounded-full border px-3 py-1 text-xs font-medium shadow-sm ${tone}`}
      style={{ top: "calc(env(safe-area-inset-top) + 9.5rem)" }}
    >
      {LABELS[effective]}
    </div>
  );
}
