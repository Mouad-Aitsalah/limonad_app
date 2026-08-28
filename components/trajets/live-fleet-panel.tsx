"use client";

import * as React from "react";
import { LocateFixed, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import type { FleetGpsStatus, FleetTruckDto } from "@/types/fleet-tracking";

const statusConfig: Record<
  FleetGpsStatus,
  { label: string; dot: string; badge: string }
> = {
  ACTIVE: {
    label: "GPS actif",
    dot: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  SLOW: {
    label: "GPS lent",
    dot: "bg-amber-500",
    badge: "border-amber-200 bg-amber-50 text-amber-700",
  },
  INACTIVE: {
    label: "GPS inactif",
    dot: "bg-rose-500",
    badge: "border-rose-200 bg-rose-50 text-rose-700",
  },
  NONE: {
    label: "Aucun point GPS",
    dot: "bg-slate-400",
    badge: "border-slate-200 bg-slate-50 text-slate-600",
  },
};

type StatusFilter = "all" | FleetGpsStatus;

type LiveFleetPanelProps = {
  trucks: FleetTruckDto[];
  loading: boolean;
  error: string | null;
  selectedTruckId: string | null;
  onSelectTruck: (truckId: string) => void;
  followedTruckId: string | null;
  followPaused: boolean;
  onFollow: (truckId: string) => void;
  onUnfollow: () => void;
  onResumeFollow: () => void;
  onRefresh: () => void;
};

export function LiveFleetPanel({
  trucks,
  loading,
  error,
  selectedTruckId,
  onSelectTruck,
  followedTruckId,
  followPaused,
  onFollow,
  onUnfollow,
  onResumeFollow,
  onRefresh,
}: LiveFleetPanelProps) {
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return trucks.filter((truck) => {
      const matchesStatus = statusFilter === "all" || truck.gpsStatus === statusFilter;
      const matchesSearch =
        query.length === 0 ||
        `${truck.driverName} ${truck.truckCode} ${truck.truckRegistration}`
          .toLowerCase()
          .includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [trucks, search, statusFilter]);

  const selectedTruck = trucks.find((truck) => truck.truckId === selectedTruckId) ?? null;
  const isFollowingSelected = selectedTruck && followedTruckId === selectedTruck.truckId;

  return (
    <div className="space-y-4">
      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              {trucks.length} camion{trucks.length > 1 ? "s" : ""} en tournee
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRefresh}
              aria-label="Actualiser"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Chauffeur, camion, immatriculation..."
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
              Tous
            </FilterChip>
            {(Object.keys(statusConfig) as FleetGpsStatus[]).map((status) => (
              <FilterChip
                key={status}
                active={statusFilter === status}
                onClick={() => setStatusFilter(status)}
              >
                {statusConfig[status].label}
              </FilterChip>
            ))}
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {loading ? "Chargement..." : "Aucun camion ne correspond a ces criteres."}
              </p>
            ) : (
              filtered.map((truck) => (
                <button
                  key={truck.truckId}
                  type="button"
                  onClick={() => onSelectTruck(truck.truckId)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left transition",
                    truck.truckId === selectedTruckId
                      ? "border-emerald-300 bg-emerald-50/70"
                      : "border-border/70 bg-background hover:bg-muted/50",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {truck.truckCode} - {truck.driverName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {truck.truckRegistration}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium",
                      statusConfig[truck.gpsStatus].badge,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", statusConfig[truck.gpsStatus].dot)} />
                    {statusConfig[truck.gpsStatus].label}
                  </span>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {selectedTruck ? (
        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Camion selectionne
                </p>
                <h3 className="mt-1 text-lg font-semibold text-foreground">
                  {selectedTruck.truckCode}
                </h3>
                <p className="text-sm text-muted-foreground">{selectedTruck.driverName}</p>
              </div>
              <Badge variant="outline" className={statusConfig[selectedTruck.gpsStatus].badge}>
                {statusConfig[selectedTruck.gpsStatus].label}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <DetailStat label="Immatriculation" value={selectedTruck.truckRegistration} />
              <DetailStat label="Tournee" value={selectedTruck.tourCode} />
              <DetailStat
                label="Derniere synchro"
                value={
                  selectedTruck.position ? formatTime(selectedTruck.position.recordedAt) : "-"
                }
              />
              <DetailStat
                label="Precision GPS"
                value={
                  selectedTruck.position?.accuracy
                    ? `+/-${Math.round(selectedTruck.position.accuracy)} m`
                    : "-"
                }
              />
              <DetailStat
                label="Vitesse"
                value={
                  selectedTruck.position?.speed != null
                    ? `${Math.round(selectedTruck.position.speed * 3.6)} km/h`
                    : "-"
                }
              />
              <DetailStat label="Clients visites" value={String(selectedTruck.clientsVisited)} />
              <DetailStat
                label="CA tournee"
                value={formatCurrency(selectedTruck.salesAmount)}
                secondary={`${selectedTruck.salesCount} vente${selectedTruck.salesCount > 1 ? "s" : ""}`}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {isFollowingSelected ? (
                followPaused ? (
                  <Button type="button" className="flex-1 rounded-2xl" onClick={onResumeFollow}>
                    <LocateFixed className="h-4 w-4" />
                    Reprendre le suivi
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 rounded-2xl"
                    onClick={onUnfollow}
                  >
                    Arreter de suivre
                  </Button>
                )
              ) : (
                <Button
                  type="button"
                  className="flex-1 rounded-2xl"
                  onClick={() => onFollow(selectedTruck.truckId)}
                  disabled={!selectedTruck.position}
                >
                  <LocateFixed className="h-4 w-4" />
                  Suivre ce camion
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60",
      )}
    >
      {children}
    </button>
  );
}

function DetailStat({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold text-foreground">{value}</p>
      {secondary ? <p className="text-xs text-muted-foreground">{secondary}</p> : null}
    </div>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
