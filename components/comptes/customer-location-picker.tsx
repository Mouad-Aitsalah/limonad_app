"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { LocateFixed, MapPin, Navigation, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CustomerLocationPickerProps = {
  customerName?: string;
  latitude?: number | null;
  longitude?: number | null;
  onChange: (position: { latitude: number | null; longitude: number | null }) => void;
};

type MapPickerProps = {
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  selectedPosition: { latitude: number; longitude: number } | null;
  onSelect: (position: { latitude: number; longitude: number }) => void;
};

const CustomerLocationPickerMap = dynamic<MapPickerProps>(
  () =>
    import("./customer-location-picker-map").then((module) => module.CustomerLocationPickerMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] rounded-[24px] bg-[linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)] sm:h-[420px]" />
    ),
  },
);

export function CustomerLocationPicker({
  customerName,
  latitude,
  longitude,
  onChange,
}: CustomerLocationPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [draftPosition, setDraftPosition] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [isLocating, setIsLocating] = React.useState(false);

  const savedPosition =
    latitude !== null &&
    latitude !== undefined &&
    longitude !== null &&
    longitude !== undefined
      ? { latitude, longitude }
      : null;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraftPosition(savedPosition);
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      setIsLocating(false);
    }
  }

  function handleUseCurrentPosition() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      toast.error("La geolocalisation n'est pas disponible sur cet appareil.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDraftPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setIsLocating(false);
      },
      (error) => {
        setIsLocating(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            toast.error("L'acces a votre localisation a ete refuse.");
            break;
          case error.POSITION_UNAVAILABLE:
            toast.error("Impossible de determiner votre position GPS.");
            break;
          case error.TIMEOUT:
            toast.error("La localisation prend trop de temps. Reessayez.");
            break;
          default:
            toast.error("La geolocalisation est indisponible pour le moment.");
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      },
    );
  }

  function handleConfirm() {
    if (!draftPosition) {
      toast.error("Choisissez une position sur la carte.");
      return;
    }

    onChange(draftPosition);
    setOpen(false);
  }

  function handleClear() {
    onChange({ latitude: null, longitude: null });
    setDraftPosition(null);
  }

  return (
    <div className="space-y-3 rounded-[24px] border border-border/70 bg-muted/25 p-4 sm:col-span-2">
      <div>
        <p className="text-sm font-semibold text-foreground">Emplacement du client</p>
        <p className="text-sm text-muted-foreground">
          Choisissez l&apos;emplacement directement sur la carte. Les coordonnees restent optionnelles.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <MapPin className="h-4 w-4" />
          {savedPosition ? "Modifier l'emplacement" : "Choisir sur la carte"}
        </Button>
        {savedPosition ? (
          <Button type="button" variant="ghost" onClick={handleClear}>
            <Trash2 className="h-4 w-4" />
            Supprimer l&apos;emplacement
          </Button>
        ) : null}
      </div>

      {savedPosition ? (
        <div className="grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-emerald-700">Latitude</p>
            <p className="mt-1 font-medium text-foreground">{savedPosition.latitude.toFixed(6)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-emerald-700">Longitude</p>
            <p className="mt-1 font-medium text-foreground">{savedPosition.longitude.toFixed(6)}</p>
          </div>
          <p className="sm:col-span-2 text-sm text-emerald-800">
            Position enregistree.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun emplacement selectionne.</p>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-[calc(100%-1rem)] p-0 sm:max-w-4xl">
          <div className="space-y-5 p-5">
            <DialogHeader>
              <DialogTitle>Choisir l&apos;emplacement du client</DialogTitle>
              <DialogDescription>
                {customerName
                  ? `Positionnez ${customerName} sur la carte.`
                  : "Cliquez sur la carte ou deplacez le marqueur pour ajuster l&apos;emplacement."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="h-[320px] overflow-hidden rounded-[24px] border border-border/70 sm:h-[420px]">
                <CustomerLocationPickerMap
                  initialLatitude={latitude}
                  initialLongitude={longitude}
                  selectedPosition={draftPosition}
                  onSelect={setDraftPosition}
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUseCurrentPosition}
                  disabled={isLocating}
                >
                  <LocateFixed className="h-4 w-4" />
                  {isLocating ? "Localisation..." : "Utiliser ma position actuelle"}
                </Button>

                {draftPosition ? (
                  <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-sm">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <Navigation className="h-4 w-4 text-emerald-700" />
                      Emplacement selectionne
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      Latitude : {draftPosition.latitude.toFixed(6)}
                    </p>
                    <p className="text-muted-foreground">
                      Longitude : {draftPosition.longitude.toFixed(6)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Cliquez sur la carte pour placer le client.
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={handleConfirm}>
              Confirmer position
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
