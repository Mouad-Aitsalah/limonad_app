"use client";

import * as React from "react";

import { createCustomerMarkerContent } from "@/components/driver-tour/tour-map-icons";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { cn } from "@/lib/utils";

const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

type CustomerLocationMapProps = {
  latitude: number;
  longitude: number;
  /** When set, the marker becomes draggable and this fires with its new position on drop. */
  onPositionChange?: (position: { latitude: number; longitude: number }) => void;
  className?: string;
};

/**
 * Small, single-marker map preview for confirming (and optionally
 * fine-tuning) a customer's GPS position before saving it.
 *
 * Reuses the exact same Google Maps loader (lib/google-maps-loader.ts) and
 * "market" AdvancedMarkerElement badge (components/driver-tour/tour-map-icons.tsx)
 * as the driver tour map - no second Maps integration, just the same
 * pieces scoped down to one marker instead of a full tour.
 */
export function CustomerLocationMap({
  latitude,
  longitude,
  onPositionChange,
  className,
}: CustomerLocationMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<GoogleMapsMap | null>(null);
  const markerRef = React.useRef<GoogleMapsAdvancedMarker | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const onPositionChangeRef = React.useRef(onPositionChange);

  React.useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  });

  React.useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(async (google) => {
        if (!GOOGLE_MAPS_MAP_ID) {
          throw new Error(
            "Configurez NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID pour afficher la carte.",
          );
        }

        const [, markerLibrary] = await Promise.all([
          google.maps.importLibrary("maps"),
          google.maps.importLibrary("marker"),
        ]);

        if (cancelled || !containerRef.current) {
          return;
        }

        const map = new google.maps.Map(containerRef.current, {
          center: { lat: latitude, lng: longitude },
          zoom: 17,
          mapId: GOOGLE_MAPS_MAP_ID,
          disableDefaultUI: true,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
        });
        mapRef.current = map;

        const marker = new markerLibrary.AdvancedMarkerElement({
          map,
          position: { lat: latitude, lng: longitude },
          title: "Position du client",
          content: createCustomerMarkerContent({
            status: "PENDING",
            selected: false,
            suggested: false,
          }),
          gmpDraggable: Boolean(onPositionChangeRef.current),
        });
        markerRef.current = marker;

        if (onPositionChangeRef.current) {
          marker.addListener("gmp-dragend", () => {
            const position = markerRef.current?.position;
            if (position) {
              onPositionChangeRef.current?.({ latitude: position.lat, longitude: position.lng });
            }
          });
        }

        setMapReady(true);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setMapError(error.message);
        }
      });

    return () => {
      cancelled = true;
      if (markerRef.current) {
        markerRef.current.map = null;
        markerRef.current = null;
      }
      mapRef.current = null;
    };
    // Deliberately mount-only: the effect below keeps the marker/center in
    // sync with latitude/longitude without tearing down and recreating the
    // whole map on every fresh GPS fix or drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!mapReady || !mapRef.current || !markerRef.current) {
      return;
    }
    const position = { lat: latitude, lng: longitude };
    markerRef.current.position = position;
    mapRef.current.setCenter(position);
  }, [latitude, longitude, mapReady]);

  if (mapError) {
    return (
      <div
        className={cn(
          "flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground",
          className,
        )}
      >
        {mapError}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("h-44 w-full overflow-hidden rounded-2xl sm:h-52", className)}
    />
  );
}
