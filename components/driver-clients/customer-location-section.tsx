"use client";

import * as React from "react";
import { Loader2, MapPin, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomerLocationMap } from "@/components/driver-clients/customer-location-map";
import { useDriverRuntime } from "@/hooks/use-driver-runtime";
import type { GpsFailureKind } from "@/lib/gps/gps-utils";
import { cn } from "@/lib/utils";

export type CustomerLocationValue = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
} | null;

type CustomerLocationSectionProps = {
  value: CustomerLocationValue;
  onChange: (value: CustomerLocationValue) => void;
};

/**
 * "Localisation du client" section of the driver customer form: captures a
 * fresh, reliable GPS fix on demand (never a cached/stale one), shows its
 * precision, rejects anything too imprecise, and previews it on a small
 * draggable-marker map for the driver to confirm before saving.
 *
 * The fix itself comes from hooks/use-driver-geolocation.ts's
 * captureFreshPosition, called through the shared DriverRuntimeProvider gps
 * instance (see hooks/use-driver-runtime.tsx / section 22) rather than a
 * second geolocation watcher: navigator.geolocation with maximumAge: 0 (a
 * cached browser fix is never returned), filtered through the SAME
 * "reliable" threshold already used for tour GPS tracking - accuracy <=
 * GPS_GOOD_ACCURACY_METERS (lib/gps/gps-config.ts) - so a customer's
 * location and a truck's tracked position are held to one identical
 * standard, not two different ones.
 */
export function CustomerLocationSection({ value, onChange }: CustomerLocationSectionProps) {
  const { gps } = useDriverRuntime();
  const [capturing, setCapturing] = React.useState(false);
  const [rejection, setRejection] = React.useState<string | null>(null);
  // Synchronous guard so a double-tap can never fire two overlapping GPS
  // requests (task requirement: "empecher plusieurs demandes GPS simultanees").
  const capturingRef = React.useRef(false);

  async function handleCapture() {
    if (capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    setRejection(null);

    try {
      const position = await gps.captureFreshPosition();
      if (position) {
        onChange({
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy ?? null,
        });
        setRejection(null);
      } else {
        // A previously accepted good position (if any) is deliberately left
        // untouched here - a failed refresh must never discard it.
        //
        // Reads the two lastAttempt*Ref values (plain refs), not gps.failureKind
        // / gps.lastKnownPosition (React state): the state updates scheduled
        // inside captureFreshPosition() are still batched and not yet
        // flushed at this exact point, so a state-based read here can show
        // the PREVIOUS attempt's outcome instead of the one just rejected.
        setRejection(
          resolveCaptureFailureMessage(
            gps.lastAttemptFailureKindRef.current,
            gps.lastAttemptAccuracyRef.current,
          ),
        );
      }
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }

  function handleMarkerDrag(position: { latitude: number; longitude: number }) {
    onChange({ ...position, accuracy: value?.accuracy ?? null });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">Localisation du client</p>
        <p className="text-xs text-muted-foreground">
          Rendez-vous chez le client puis appuyez sur le bouton ci-dessous.
        </p>
      </div>

      <Button
        type="button"
        variant={value ? "outline" : "default"}
        className="h-12 w-full rounded-2xl text-sm sm:w-auto sm:px-6"
        onClick={handleCapture}
        disabled={capturing}
      >
        {capturing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Recherche de votre position...
          </>
        ) : rejection ? (
          <>
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Reessayer
          </>
        ) : value ? (
          <>
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Actualiser ma position
          </>
        ) : (
          <>
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Utiliser ma position actuelle
          </>
        )}
      </Button>

      {rejection ? <p className="text-xs font-medium text-destructive">{rejection}</p> : null}

      {value ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <LocationStat label="Latitude" value={value.latitude.toFixed(5)} />
            <LocationStat label="Longitude" value={value.longitude.toFixed(5)} />
            <LocationStat
              label="Precision"
              value={value.accuracy ? `+/-${Math.round(value.accuracy)} m` : "-"}
            />
            <LocationStat label="Statut" value="Bonne precision" tone="good" />
          </div>

          <CustomerLocationMap
            latitude={value.latitude}
            longitude={value.longitude}
            onPositionChange={handleMarkerDrag}
          />
          <p className="text-xs text-muted-foreground">
            Deplacez le repere sur la carte pour ajuster l&apos;emplacement exact si besoin.
          </p>
        </div>
      ) : !rejection ? (
        <p className="text-xs text-muted-foreground">
          Localisation non renseignee. Le client sera enregistre sans position GPS tant que
          vous n&apos;utilisez pas ce bouton.
        </p>
      ) : null}
    </div>
  );
}

function LocationStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good";
}) {
  return (
    <div className="rounded-xl bg-background px-3 py-2 shadow-sm">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-semibold text-foreground",
          tone === "good" && "text-emerald-600",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function resolveCaptureFailureMessage(
  failureKind: GpsFailureKind,
  lastAttemptAccuracy: number | null,
) {
  switch (failureKind) {
    case "DENIED":
      return "Autorisez la localisation pour enregistrer la position du client.";
    case "UNAVAILABLE":
      return "Position GPS indisponible.";
    case "TIMEOUT":
      return "Impossible d'obtenir une position precise. Reessayez.";
    default:
      return lastAttemptAccuracy
        ? `Position trop imprecise (+/-${Math.round(lastAttemptAccuracy)} m). Reessayez.`
        : "Position trop imprecise. Reessayez.";
  }
}
