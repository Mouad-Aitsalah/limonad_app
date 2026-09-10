"use client";

import * as React from "react";
import { LocateFixed, MapPin } from "lucide-react";
import { toast } from "sonner";

import { CustomerLocationMap } from "@/components/driver-clients/customer-location-map";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { useDriverGeolocation } from "@/hooks/use-driver-geolocation";
import type { CustomerDto } from "@/types/operations-dto";

type LatLng = { latitude: number; longitude: number; accuracy?: number | null };

type QuickAddCustomerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gps: ReturnType<typeof useDriverGeolocation>;
  /** Last position known to the tour (state.latestPosition) - a final seed
   *  when the browser GPS hasn't produced a fix yet. */
  fallbackPosition: { latitude: number; longitude: number } | null;
  onCreated: (customer: CustomerDto) => void;
};

function readGpsSeed(
  gps: QuickAddCustomerDialogProps["gps"],
  fallback: QuickAddCustomerDialogProps["fallbackPosition"],
): LatLng | null {
  const p = gps.reliablePosition ?? gps.lastKnownPosition;
  if (p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
    return { latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy ?? null };
  }
  if (fallback && Number.isFinite(fallback.latitude) && Number.isFinite(fallback.longitude)) {
    return { latitude: fallback.latitude, longitude: fallback.longitude, accuracy: null };
  }
  return null;
}

function isUsableCoord(coords: LatLng | null): coords is LatLng {
  return (
    !!coords &&
    Number.isFinite(coords.latitude) &&
    Number.isFinite(coords.longitude) &&
    coords.latitude >= -90 &&
    coords.latitude <= 90 &&
    coords.longitude >= -180 &&
    coords.longitude <= 180
  );
}

// The whole body is only mounted while the dialog is open, so every useState
// initializer runs fresh on each open (position re-seeded from the current
// GPS) and everything is cleared on close by unmount - no reset effects.
function QuickAddCustomerBody({
  gps,
  fallbackPosition,
  onOpenChange,
  onCreated,
}: Omit<QuickAddCustomerDialogProps, "open">) {
  const [name, setName] = React.useState("");
  const [coords, setCoords] = React.useState<LatLng | null>(() =>
    readGpsSeed(gps, fallbackPosition),
  );
  const [locating, setLocating] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function refreshPosition() {
    setLocating(true);
    setError(null);
    try {
      const fresh = await gps.captureFreshPosition();
      if (fresh && Number.isFinite(fresh.latitude) && Number.isFinite(fresh.longitude)) {
        setCoords({
          latitude: fresh.latitude,
          longitude: fresh.longitude,
          accuracy: fresh.accuracy ?? null,
        });
      } else {
        setError(gps.errorMessage ?? "Position GPS indisponible.");
      }
    } finally {
      setLocating(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Le nom est obligatoire.");
      return;
    }
    if (!isUsableCoord(coords)) {
      setError("Placez le client sur la carte (position GPS indisponible).");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/driver/customers/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          latitude: coords.latitude,
          longitude: coords.longitude,
          locationAccuracy: coords.accuracy ?? null,
        }),
      });
      const payload = (await response.json()) as { customer?: CustomerDto; message?: string };
      if (!response.ok || !payload.customer) {
        setError(payload.message ?? "Impossible d'enregistrer le client.");
        return;
      }
      toast.success("Client ajouté");
      onCreated(payload.customer);
      onOpenChange(false);
    } catch {
      setError("Impossible d'enregistrer le client.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="quick-customer-name">
          Nom et prénom <span className="text-red-600">*</span>
        </Label>
        <Input
          id="quick-customer-name"
          value={name}
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(null);
          }}
          placeholder="Ex : Zakaria Dakhch"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
            Emplacement <span className="text-red-600">*</span>
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            disabled={locating}
            onClick={() => void refreshPosition()}
          >
            <LocateFixed aria-hidden="true" className="h-4 w-4" />
            {locating ? "Localisation…" : "Position actuelle"}
          </Button>
        </div>

        {coords ? (
          <>
            <CustomerLocationMap
              latitude={coords.latitude}
              longitude={coords.longitude}
              onPositionChange={(next) => {
                setCoords({ ...next, accuracy: null });
                if (error) setError(null);
              }}
              className="h-48 w-full overflow-hidden rounded-2xl"
            />
            <p className="text-xs text-muted-foreground">
              {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
              {typeof coords.accuracy === "number" ? ` · ±${Math.round(coords.accuracy)} m` : ""}
              {" · "}
              Touchez et glissez le repère pour ajuster.
            </p>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            Position GPS indisponible. Touchez « Position actuelle » pour réessayer.
          </div>
        )}
      </div>

      {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          Annuler
        </Button>
        <Button type="submit" disabled={submitting || !name.trim() || !coords}>
          {submitting ? "Ajout…" : "Ajouter"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function QuickAddCustomerDialog({
  open,
  onOpenChange,
  gps,
  fallbackPosition,
  onCreated,
}: QuickAddCustomerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter un client</DialogTitle>
          <DialogDescription>
            Nom et emplacement uniquement — les autres informations pourront être
            complétées plus tard.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <QuickAddCustomerBody
            gps={gps}
            fallbackPosition={fallbackPosition}
            onOpenChange={onOpenChange}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
