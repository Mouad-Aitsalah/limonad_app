"use client";

import * as React from "react";
import { MonitorSmartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import { CONNECTIONS_REFRESH_MS } from "@/lib/session-activity";
import type { OrganizationConnectionsSnapshot } from "@/lib/session-activity";
import type { OrganizationDetailDto } from "@/types/organization";

type OrgUser = OrganizationDetailDto["users"][number];

const ROLE_LABELS: Record<OrgUser["role"], string> = {
  SUPER_ADMIN: "Super administrateur",
  ADMIN: "Administrateur",
  DEPOT_MANAGER: "Responsable dépôt",
  CASHIER: "Caissier",
  DRIVER: "Chauffeur",
};

/**
 * Live connected-devices snapshot, refreshed every CONNECTIONS_REFRESH_MS
 * (polling - the project has no WebSocket layer) while the tab is visible,
 * and once more when it becomes visible again. The last good snapshot is kept
 * if a refresh fails.
 */
function useOrganizationConnections(
  organizationId: string,
  initial: OrganizationConnectionsSnapshot | null,
) {
  const [snapshot, setSnapshot] = React.useState(initial);
  const [failed, setFailed] = React.useState(initial === null);

  React.useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;

    async function refresh() {
      if (document.visibilityState !== "visible") return;
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      try {
        const response = await fetch(`/api/organizations/${organizationId}/connections`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("connections");
        const body = (await response.json()) as { connections: OrganizationConnectionsSnapshot };
        if (cancelled) return;
        setSnapshot(body.connections);
        setFailed(false);
      } catch {
        if (!cancelled && !controller.signal.aborted) setFailed(true);
      }
    }

    // First refresh right away only when the server did not provide a snapshot.
    if (initial === null) void refresh();
    const intervalId = window.setInterval(() => void refresh(), CONNECTIONS_REFRESH_MS);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      inFlight?.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `initial` is only the starting value; later renders must not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  return { snapshot, failed };
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        online ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" : "bg-slate-300",
      )}
    />
  );
}

export function OrganizationConnectionsPanel({
  organizationId,
  users,
  initialConnections,
}: {
  organizationId: string;
  users: OrgUser[];
  initialConnections: OrganizationConnectionsSnapshot | null;
}) {
  const { snapshot, failed } = useOrganizationConnections(organizationId, initialConnections);
  const byUser = new Map((snapshot?.users ?? []).map((entry) => [entry.userId, entry]));

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-emerald-50/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <MonitorSmartphone aria-hidden="true" className="h-5 w-5 text-emerald-700" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Appareils connectés
            </p>
            <p className="text-lg font-semibold text-foreground">
              {snapshot ? snapshot.totalDevices : "-"}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {snapshot
                  ? `${snapshot.onlineUsers} utilisateur${snapshot.onlineUsers > 1 ? "s" : ""} en ligne`
                  : "indisponible"}
              </span>
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {failed
            ? "Actualisation impossible - dernières données affichées"
            : `Actualisé automatiquement (${Math.round(CONNECTIONS_REFRESH_MS / 1000)} s)`}
        </p>
      </div>

      {snapshot?.deviceTracking === "session" ? (
        <p className="px-1 text-xs text-muted-foreground">
          Regroupement par appareil indisponible (mise à jour de la base en attente) : chaque
          session active est comptée comme un appareil.
        </p>
      ) : null}

      {users.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Aucun utilisateur.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {users.map((user) => {
            const devices = byUser.get(user.id)?.devices ?? 0;
            const online = devices > 0;
            return (
              <li
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{user.fullName}</p>
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="tabular-nums text-muted-foreground">
                    {devices} appareil{devices > 1 ? "s" : ""} connecté{devices > 1 ? "s" : ""}
                  </span>
                  <span
                    className={cn(
                      "inline-flex min-w-[5.5rem] items-center gap-1.5 text-xs font-semibold",
                      online ? "text-emerald-700" : "text-slate-500",
                    )}
                  >
                    <StatusDot online={online} />
                    {online ? "En ligne" : "Hors ligne"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
