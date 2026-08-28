"use client";

import * as React from "react";

import { createTruckMarkerContent } from "@/components/driver-tour/tour-map-icons";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { DEFAULT_MAP_CENTER } from "@/lib/gps/gps-config";
import {
  calculateDistanceMeters,
  resolveReliableHeadingDegrees,
  shouldBreakGpsSegment,
  splitGpsRouteIntoSegments,
} from "@/lib/gps/gps-utils";
import type { FleetTruckDto } from "@/types/fleet-tracking";

const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

const MIN_ANIMATION_MS = 500;
const MAX_ANIMATION_MS = 1500;
/** Distance beyond which the smooth-move animation is fully saturated at MAX_ANIMATION_MS. */
const ANIMATION_SATURATION_METERS = 150;

type TruckMapPoint = { latitude: number; longitude: number; recordedAt: string };

type TrackedTruck = {
  marker: GoogleMapsAdvancedMarker;
  /** The last raw (server-recorded) position - used for break/animation decisions, distinct from the marker's current mid-animation visual position. */
  lastRawPosition: TruckMapPoint;
  /** Points accumulated since this admin session opened the view - the live trace, not the full historical route (see truck-routes.ts for that, loaded separately on demand). */
  points: TruckMapPoint[];
  polylines: GoogleMapsPolyline[];
  animationFrame: number | null;
};

type LiveFleetMapProps = {
  trucks: FleetTruckDto[];
  selectedTruckId: string | null;
  onSelectTruck: (truckId: string) => void;
  /** True while a truck is selected AND the admin hasn't manually panned away - see LiveFleetView for the pause/resume state machine. */
  isFollowing: boolean;
  /** The map was dragged by the admin - parent should pause auto-follow and offer "Reprendre le suivi". */
  onManualPan: () => void;
};

/**
 * Admin fleet map: one AdvancedMarkerElement truck icon per currently
 * in-progress tour, smoothly animated between GPS polls (never teleporting)
 * unless the new point is a genuine break (see shouldBreakGpsSegment - the
 * exact same rule already used to segment the driver's own route and the
 * historical /trajets polyline, reused here rather than reinvented).
 *
 * Reuses loadGoogleMaps + createTruckMarkerContent (the same "truck" badge
 * as the driver's own "Mon camion" marker) - no second Maps integration,
 * no second icon set.
 */
export function LiveFleetMap({
  trucks,
  selectedTruckId,
  onSelectTruck,
  isFollowing,
  onManualPan,
}: LiveFleetMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const googleRef = React.useRef<GoogleMapsApi | null>(null);
  const markerLibraryRef = React.useRef<GoogleMapsMarkerLibrary | null>(null);
  const mapRef = React.useRef<GoogleMapsMap | null>(null);
  const trackedRef = React.useRef<Map<string, TrackedTruck>>(new Map());
  const hasFitBoundsRef = React.useRef(false);
  const onSelectTruckRef = React.useRef(onSelectTruck);
  const onManualPanRef = React.useRef(onManualPan);

  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);

  React.useEffect(() => {
    onSelectTruckRef.current = onSelectTruck;
    onManualPanRef.current = onManualPan;
  });

  React.useEffect(() => {
    let cancelled = false;
    let dragListener: GoogleMapsListener | null = null;

    loadGoogleMaps()
      .then(async (google) => {
        if (!GOOGLE_MAPS_MAP_ID) {
          throw new Error(
            "Configurez NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID pour afficher la carte (requis par AdvancedMarkerElement).",
          );
        }

        const [, markerLibrary] = await Promise.all([
          google.maps.importLibrary("maps"),
          google.maps.importLibrary("marker"),
        ]);

        if (cancelled || !containerRef.current) {
          return;
        }

        googleRef.current = google;
        markerLibraryRef.current = markerLibrary;
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: toLatLng(DEFAULT_MAP_CENTER),
          zoom: 12,
          mapId: GOOGLE_MAPS_MAP_ID,
          disableDefaultUI: true,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
          zoomControlOptions: { position: 6 },
        });

        dragListener = mapRef.current.addListener("dragstart", () => {
          onManualPanRef.current();
        });

        setMapReady(true);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setMapError(error.message);
        }
      });

    return () => {
      cancelled = true;
      dragListener?.remove();
      for (const tracked of trackedRef.current.values()) {
        if (tracked.animationFrame != null) {
          cancelAnimationFrame(tracked.animationFrame);
        }
        tracked.marker.map = null;
        clearPolylines(tracked.polylines);
      }
      trackedRef.current.clear();
    };
  }, []);

  React.useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    const markerLibrary = markerLibraryRef.current;
    if (!google || !map || !markerLibrary || !mapReady) {
      return;
    }

    const seenTruckIds = new Set<string>();

    for (const truck of trucks) {
      seenTruckIds.add(truck.truckId);
      if (!truck.position) {
        continue;
      }

      const nextPoint: TruckMapPoint = {
        latitude: truck.position.latitude,
        longitude: truck.position.longitude,
        recordedAt: truck.position.recordedAt,
      };
      const headingDegrees = resolveReliableHeadingDegrees(
        truck.position.heading,
        truck.position.speed,
      );

      let tracked = trackedRef.current.get(truck.truckId);

      if (!tracked) {
        const marker = new markerLibrary.AdvancedMarkerElement({
          map,
          position: toGoogleLatLng(nextPoint),
          title: `${truck.truckCode} - ${truck.driverName}`,
          content: createTruckMarkerContent({ headingDegrees }),
          zIndex: 500,
        });
        marker.addListener("gmp-click", () => onSelectTruckRef.current(truck.truckId));

        tracked = {
          marker,
          lastRawPosition: nextPoint,
          points: [nextPoint],
          polylines: [],
          animationFrame: null,
        };
        trackedRef.current.set(truck.truckId, tracked);
        redrawTrace(google, map, tracked);
        continue;
      }

      if (nextPoint.recordedAt === tracked.lastRawPosition.recordedAt) {
        // Same point as the last poll - nothing moved.
        continue;
      }

      if (tracked.animationFrame != null) {
        cancelAnimationFrame(tracked.animationFrame);
        tracked.animationFrame = null;
      }

      const isBreak = shouldBreakGpsSegment(tracked.lastRawPosition, nextPoint);
      tracked.marker.content = createTruckMarkerContent({ headingDegrees });

      if (isBreak) {
        // A doubtful jump (bad accuracy, huge gap, impossible speed, GPS
        // back after a long silence) - snap instead of animating through it,
        // and start a fresh trace segment rather than connecting the two.
        tracked.marker.position = toGoogleLatLng(nextPoint);
      } else {
        animateMarkerPosition(tracked, nextPoint);
      }

      tracked.points.push(nextPoint);
      tracked.lastRawPosition = nextPoint;
      redrawTrace(google, map, tracked);
    }

    const staleTruckIds = [...trackedRef.current.keys()].filter(
      (truckId) => !seenTruckIds.has(truckId),
    );
    for (const truckId of staleTruckIds) {
      const stale = trackedRef.current.get(truckId);
      if (!stale) {
        continue;
      }
      if (stale.animationFrame != null) {
        cancelAnimationFrame(stale.animationFrame);
      }
      stale.marker.map = null;
      clearPolylines(stale.polylines);
      trackedRef.current.delete(truckId);
    }

    if (!hasFitBoundsRef.current && trucks.some((truck) => truck.position)) {
      hasFitBoundsRef.current = true;
      fitAllTrucks(google, map, trucks);
    }
  }, [trucks, mapReady]);

  React.useEffect(() => {
    if (!isFollowing || !selectedTruckId || !mapReady || !mapRef.current) {
      return;
    }
    const tracked = trackedRef.current.get(selectedTruckId);
    if (!tracked) {
      return;
    }
    mapRef.current.panTo(toGoogleLatLng(tracked.lastRawPosition));
  }, [isFollowing, selectedTruckId, trucks, mapReady]);

  React.useEffect(() => {
    if (!selectedTruckId || !mapReady || !mapRef.current) {
      return;
    }
    const tracked = trackedRef.current.get(selectedTruckId);
    if (!tracked) {
      return;
    }
    mapRef.current.panTo(toGoogleLatLng(tracked.lastRawPosition));
    mapRef.current.setZoom(Math.max(mapRef.current.getZoom() ?? 14, 15));
    // Only when the selection itself changes - not on every poll (the
    // isFollowing effect above handles ongoing recentering while following).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTruckId, mapReady]);

  return (
    <div className="relative h-[560px] w-full sm:h-[680px]">
      <div ref={containerRef} className="h-full w-full" />

      {mapError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 px-6 text-center">
          <div className="max-w-sm rounded-3xl border border-border bg-background p-5 shadow-[0_18px_46px_rgba(15,23,42,0.14)]">
            <p className="font-semibold text-foreground">Carte indisponible</p>
            <p className="mt-2 text-sm text-muted-foreground">{mapError}</p>
          </div>
        </div>
      ) : null}

      {!mapError && trucks.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-4 top-4 z-[600] flex justify-center">
          <div className="rounded-2xl bg-background/95 px-4 py-2 text-sm text-muted-foreground shadow-[0_10px_26px_rgba(15,23,42,0.12)]">
            Aucun camion en tournee actuellement.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function animateMarkerPosition(tracked: TrackedTruck, to: TruckMapPoint) {
  const from = tracked.marker.position;
  const toLatLngLiteral = toGoogleLatLng(to);

  if (!from) {
    tracked.marker.position = toLatLngLiteral;
    return;
  }

  const distanceMeters = calculateDistanceMeters(
    { latitude: from.lat, longitude: from.lng },
    to,
  );
  const progressRatio = Math.min(1, distanceMeters / ANIMATION_SATURATION_METERS);
  const durationMs = MIN_ANIMATION_MS + progressRatio * (MAX_ANIMATION_MS - MIN_ANIMATION_MS);

  const startLat = from.lat;
  const startLng = from.lng;
  const startTime = performance.now();

  function step(now: number) {
    const elapsedRatio = Math.min(1, (now - startTime) / durationMs);
    const eased = easeInOutQuad(elapsedRatio);
    tracked.marker.position = {
      lat: startLat + (toLatLngLiteral.lat - startLat) * eased,
      lng: startLng + (toLatLngLiteral.lng - startLng) * eased,
    };

    if (elapsedRatio < 1) {
      tracked.animationFrame = requestAnimationFrame(step);
    } else {
      tracked.animationFrame = null;
    }
  }

  tracked.animationFrame = requestAnimationFrame(step);
}

function redrawTrace(google: GoogleMapsApi, map: GoogleMapsMap, tracked: TrackedTruck) {
  clearPolylines(tracked.polylines);
  tracked.polylines = splitGpsRouteIntoSegments(tracked.points)
    .filter((segment) => segment.length > 1)
    .map(
      (segment) =>
        new google.maps.Polyline({
          map,
          path: segment.map(toGoogleLatLng),
          strokeColor: "#10b981",
          strokeOpacity: 0.85,
          strokeWeight: 4,
          geodesic: true,
        }),
    );
}

function fitAllTrucks(google: GoogleMapsApi, map: GoogleMapsMap, trucks: FleetTruckDto[]) {
  const positions = trucks
    .map((truck) => truck.position)
    .filter((position): position is NonNullable<typeof position> => Boolean(position));

  if (positions.length === 0) {
    return;
  }

  if (positions.length === 1) {
    map.setCenter(toGoogleLatLng(positions[0]));
    map.setZoom(14);
    return;
  }

  const bounds = new google.maps.LatLngBounds();
  for (const position of positions) {
    bounds.extend(toGoogleLatLng(position));
  }
  map.fitBounds(bounds);
}

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function toGoogleLatLng(point: { latitude: number; longitude: number }) {
  return { lat: point.latitude, lng: point.longitude };
}

function toLatLng(point: [number, number]) {
  return { lat: point[0], lng: point[1] };
}

function clearPolylines(polylines: GoogleMapsPolyline[]) {
  for (const polyline of polylines) {
    polyline.setMap(null);
  }
}
