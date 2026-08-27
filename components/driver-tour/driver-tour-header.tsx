"use client";

import { Menu } from "lucide-react";

import { useSidebar } from "@/hooks/use-sidebar";
import type { GpsStatus } from "@/lib/gps/gps-utils";
import { cn } from "@/lib/utils";

const gpsStatusLabels: Record<GpsStatus, string> = {
  ACTIVE: "GPS actif",
  APPROXIMATE: "GPS approximatif",
  SEARCHING: "Recherche GPS...",
  SLOW: "GPS lent",
  INACTIVE: "GPS inactif",
  DENIED: "Localisation refusee",
  UNAVAILABLE: "GPS indisponible",
};

const gpsStatusClasses: Record<GpsStatus, string> = {
  ACTIVE: "bg-emerald-500",
  APPROXIMATE: "bg-lime-500",
  SEARCHING: "bg-sky-500",
  SLOW: "bg-amber-500",
  INACTIVE: "bg-rose-500",
  DENIED: "bg-red-600",
  UNAVAILABLE: "bg-slate-400",
};

export function DriverTourHeader({
  driverName,
  truckCode,
  gpsStatus,
}: {
  driverName?: string | null;
  truckCode?: string | null;
  gpsStatus: GpsStatus;
}) {
  const { openMobile } = useSidebar();

  return (
    <header className="sticky top-0 z-[700] border-b border-border/70 bg-background/94 backdrop-blur">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={openMobile}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm lg:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground sm:text-base">
              Ma tournee
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {driverName || "Chauffeur"} {truckCode ? `• ${truckCode}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full bg-muted/70 px-3 py-2 text-xs font-medium text-foreground">
          <span
            aria-hidden="true"
            className={cn("h-2.5 w-2.5 rounded-full", gpsStatusClasses[gpsStatus])}
          />
          <span className="whitespace-nowrap">{gpsStatusLabels[gpsStatus]}</span>
        </div>
      </div>
    </header>
  );
}
