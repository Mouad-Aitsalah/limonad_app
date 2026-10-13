import { CloudOff, RefreshCw, Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { NetworkState, SalesSyncStatus } from "@/lib/offline/counter-pos";

type OfflineStatusBarProps = {
  networkState: NetworkState;
  /** Waiting to be sent. */
  pendingCount: number;
  /** Rejected / out of retries. */
  failedCount: number;
  syncStatus: SalesSyncStatus;
  onSyncNow: () => void;
  /**
   * "bar" (default): its own coloured strip. "inline": one segment of the POS
   * header block (components/pos/pos-header-info.tsx) - same states, counters
   * and "Synchroniser maintenant" button, without its own card; the offline
   * explanation becomes the segment's tooltip and screen-reader text.
   */
  variant?: "bar" | "inline";
};

const OFFLINE_EXPLANATION = "les ventes sont gardées sur ce poste et envoyées à la reconnexion.";

function plural(count: number, one: string, many: string) {
  return `${count} ${count > 1 ? many : one}`;
}

/**
 * Network + synchronisation state of the counter POS. Never claims a local
 * sale is in the central database before the server confirmed it: it only
 * says how many are waiting, synchronised or in error.
 */
export function OfflineStatusBar({
  networkState,
  pendingCount,
  failedCount,
  syncStatus,
  onSyncNow,
  variant = "bar",
}: OfflineStatusBarProps) {
  const inline = variant === "inline";
  const offline = networkState !== "ONLINE";
  const label =
    networkState === "ONLINE"
      ? "En ligne"
      : networkState === "OFFLINE"
        ? "Hors connexion"
        : "Serveur injoignable — mode hors connexion";

  const lastResult = syncStatus.lastRun?.result;
  const syncedCount = lastResult?.synced ?? 0;
  const serverProblem =
    lastResult?.status === "STOPPED_NETWORK" || lastResult?.status === "STOPPED_SERVER";
  const authPaused = lastResult?.status === "PAUSED_AUTH";
  // Plain "En ligne" with nothing else to show: the bar shrinks to its content
  // (icon + label) instead of spanning the whole POS width.
  const compact =
    !offline && !syncStatus.running && syncedCount === 0 && failedCount === 0 && pendingCount === 0;

  return (
    <div
      role="status"
      data-testid="pos-network-status"
      data-state={networkState}
      title={inline && offline ? `${label} — ${OFFLINE_EXPLANATION}` : undefined}
      className={
        inline
          ? `flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-medium ${offline ? "text-amber-800" : "text-emerald-700"}`
          : offline
          ? "flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
          : compact
            ? "flex w-fit items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900"
            : "flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900"
      }
    >
      {offline ? (
        <CloudOff aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <Wifi aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      <span className={inline ? "whitespace-nowrap" : undefined}>{label}</span>
      {offline ? (
        <span className={inline ? "sr-only" : "font-normal"}>— {OFFLINE_EXPLANATION}</span>
      ) : null}

      {compact ? null : (
      <div className={inline ? "flex flex-wrap items-center gap-2 text-xs" : "ml-auto flex flex-wrap items-center gap-2"}>
        {syncStatus.running ? (
          <span data-testid="pos-sync-running" className="inline-flex items-center gap-1.5">
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 motion-safe:animate-spin" />
            Synchronisation en cours...
          </span>
        ) : null}
        {!syncStatus.running && syncedCount > 0 ? (
          <span data-testid="pos-sync-done" className="rounded-full bg-white/70 px-2 py-0.5">
            {plural(syncedCount, "vente synchronisée", "ventes synchronisées")}
          </span>
        ) : null}
        {failedCount > 0 ? (
          <span
            data-testid="pos-sync-failed"
            className="rounded-full bg-red-100 px-2 py-0.5 text-red-800"
          >
            {plural(failedCount, "vente en erreur", "ventes en erreur")}
          </span>
        ) : null}
        {pendingCount > 0 ? (
          <span data-testid="pos-unsynced-count" className="rounded-full bg-white/70 px-2 py-0.5">
            {plural(pendingCount, "vente en attente", "ventes en attente")} de synchronisation
          </span>
        ) : null}
        {!syncStatus.running && pendingCount > 0 && (serverProblem || authPaused) ? (
          <span data-testid="pos-sync-problem" className="font-normal">
            {authPaused
              ? "Session expirée : reconnectez-vous pour synchroniser."
              : "Serveur indisponible : les ventes sont conservées, nouvelle tentative automatique."}
          </span>
        ) : null}
        {pendingCount > 0 || failedCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 bg-white/80 text-xs"
            disabled={syncStatus.running || pendingCount === 0}
            onClick={onSyncNow}
            data-testid="pos-sync-now"
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            Synchroniser maintenant
          </Button>
        ) : null}
      </div>
      )}
    </div>
  );
}
