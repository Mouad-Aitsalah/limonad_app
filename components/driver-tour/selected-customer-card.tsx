"use client";

import { MapPinned, Phone, ShoppingCart, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GoogleRouteDto } from "@/types/maps";
import type { DriverTourCustomerDto } from "@/types/operations-dto";

const statusStyles: Record<
  DriverTourCustomerDto["visitStatus"],
  { label: string; className: string }
> = {
  PENDING: { label: "A visiter", className: "border-amber-200 bg-amber-50 text-amber-800" },
  NEARBY: { label: "Client proche", className: "border-amber-200 bg-amber-50 text-amber-800" },
  ARRIVED: { label: "Arrive", className: "border-sky-200 bg-sky-50 text-sky-800" },
  DELIVERED: { label: "Livre", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  NO_SALE: { label: "Sans vente", className: "border-rose-200 bg-rose-50 text-rose-800" },
};

export function SelectedCustomerCard({
  customer,
  inProgress,
  canOpenItinerary,
  routeLoading,
  routeSummary,
  noSaleLoading,
  onClose,
  onCreateSale,
  onOpenItinerary,
  onMarkNoSale,
}: {
  customer: DriverTourCustomerDto;
  inProgress: boolean;
  canOpenItinerary: boolean;
  routeLoading: boolean;
  routeSummary?: GoogleRouteDto | null;
  noSaleLoading?: boolean;
  onClose: () => void;
  onCreateSale: () => void;
  onOpenItinerary: () => void;
  onMarkNoSale: () => void;
}) {
  const status = statusStyles[customer.visitStatus] ?? statusStyles.PENDING;
  const alreadyResolved =
    customer.visitStatus === "DELIVERED" || customer.visitStatus === "NO_SALE";

  return (
    <div className="customer-sheet-enter w-full rounded-[22px] border border-border/70 bg-background/97 p-4 shadow-[0_18px_46px_rgba(15,23,42,0.2)] backdrop-blur">
      <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/25" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight text-foreground">
            {customer.name}
          </p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {customer.address || customer.city || "Adresse non renseignee"}
          </p>
          {customer.phone ? (
            <a
              href={`tel:${customer.phone}`}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700"
            >
              <Phone className="h-3 w-3" />
              {customer.phone}
            </a>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la fiche client"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">
          {formatDistanceLabel(customer.distanceMeters)}
        </span>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium",
            status.className,
          )}
        >
          {status.label}
        </span>
      </div>

      {routeSummary ? (
        <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-900">
          Itineraire recommande : {formatDistanceLabel(routeSummary.distanceMeters)}
          {routeSummary.durationSeconds !== null
            ? ` - ${formatDuration(routeSummary.durationSeconds)}`
            : ""}
        </div>
      ) : null}

      <Button
        type="button"
        className="mt-3 h-11 w-full rounded-xl"
        onClick={onCreateSale}
        disabled={!inProgress}
      >
        <ShoppingCart className="h-4 w-4" />
        Faire une vente
      </Button>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10 rounded-xl bg-background/80"
          onClick={onOpenItinerary}
          disabled={!canOpenItinerary || routeLoading}
        >
          <MapPinned className="h-4 w-4" />
          {routeLoading ? "Calcul..." : "Itineraire"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10 rounded-xl bg-background/80"
          onClick={onMarkNoSale}
          disabled={!inProgress || alreadyResolved || noSaleLoading}
        >
          {noSaleLoading ? "..." : "Sans vente"}
        </Button>
      </div>
    </div>
  );
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
}

function formatDistanceLabel(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Distance indisponible";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} km`;
  }

  return `${Math.round(value)} m`;
}
