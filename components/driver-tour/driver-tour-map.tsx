"use client";

import * as React from "react";
import { toast } from "sonner";

import { RecenterMapButton } from "@/components/driver-tour/recenter-map-button";
import {
  createCustomerMarkerContent,
  createStopMarkerContent,
  createTruckMarkerContent,
} from "@/components/driver-tour/tour-map-icons";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { DEFAULT_MAP_CENTER } from "@/lib/gps/gps-config";
import { buildDisplayGpsRoute } from "@/lib/gps/gps-utils";
import { cn } from "@/lib/utils";
import type { MapCoordinate } from "@/types/maps";
import type {
  DriverTourCustomerDto,
  DriverTourPositionDto,
  DriverTourStopDto,
} from "@/types/operations-dto";

const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

export function DriverTourMap({
  customers,
  route,
  stops,
  recommendedRoute,
  currentPosition,
  suggestedCustomerId,
  selectedCustomerId,
  gpsActive,
  onSelectCustomer,
  onCreateSale,
}: {
  customers: DriverTourCustomerDto[];
  route: DriverTourPositionDto[];
  stops: DriverTourStopDto[];
  recommendedRoute?: MapCoordinate[];
  currentPosition?: DriverTourPositionDto | null;
  suggestedCustomerId?: string | null;
  selectedCustomerId?: string | null;
  gpsActive: boolean;
  onSelectCustomer: (customerId: string) => void;
  onCreateSale: (customerId: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const googleRef = React.useRef<GoogleMapsApi | null>(null);
  const markerLibraryRef = React.useRef<GoogleMapsMarkerLibrary | null>(null);
  const mapRef = React.useRef<GoogleMapsMap | null>(null);
  const routePolylinesRef = React.useRef<GoogleMapsPolyline[]>([]);
  const recommendedPolylineRef = React.useRef<GoogleMapsPolyline | null>(null);
  const customerMarkersRef = React.useRef<GoogleMapsAdvancedMarker[]>([]);
  const stopMarkersRef = React.useRef<GoogleMapsAdvancedMarker[]>([]);
  const driverMarkerRef = React.useRef<GoogleMapsAdvancedMarker | null>(null);
  const accuracyCircleRef = React.useRef<GoogleMapsCircle | null>(null);
  const infoWindowRef = React.useRef<GoogleMapsInfoWindow | null>(null);
  const hasCenteredOnDriverRef = React.useRef(false);
  const lastFocusedCustomerIdRef = React.useRef<string | null>(null);
  const initialCenterRef = React.useRef<GoogleMapsLatLngLiteral | null>(null);
  const initialZoomRef = React.useRef<number>(currentPosition ? 16 : 13);

  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [detachedFromDriver, setDetachedFromDriver] = React.useState(false);
  const [recenterTick, setRecenterTick] = React.useState(0);
  const followDriver = gpsActive && !detachedFromDriver;
  const displayRoute = React.useMemo(() => buildDisplayGpsRoute(route), [route]);

  initialCenterRef.current ??=
    (currentPosition ? toGoogleLatLng(currentPosition) : null) ??
    resolveInitialCustomerPosition(customers, selectedCustomerId, suggestedCustomerId) ??
    toLatLng(DEFAULT_MAP_CENTER);

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
          center: initialCenterRef.current,
          zoom: initialZoomRef.current,
          mapId: GOOGLE_MAPS_MAP_ID,
          disableDefaultUI: true,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
          zoomControlOptions: { position: 6 },
        });
        infoWindowRef.current = new google.maps.InfoWindow();

        dragListener = mapRef.current.addListener("dragstart", () => {
          setDetachedFromDriver(true);
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

      // Detach every AdvancedMarkerElement (real DOM content) when the map unmounts.
      if (driverMarkerRef.current) {
        driverMarkerRef.current.map = null;
        driverMarkerRef.current = null;
      }
      clearMarkers(customerMarkersRef.current);
      customerMarkersRef.current = [];
      clearMarkers(stopMarkersRef.current);
      stopMarkersRef.current = [];
      infoWindowRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !mapReady || !map) {
      return;
    }

    clearPolylines(routePolylinesRef.current);
    routePolylinesRef.current = displayRoute.segments
      .filter((segment) => segment.length > 1)
      .map(
        (segment) =>
          new google.maps.Polyline({
            map,
            path: segment.map(toGoogleLatLng),
            strokeColor: "#10b981",
            strokeOpacity: 0.9,
            strokeWeight: 7,
            geodesic: true,
          }),
      );
  }, [displayRoute.segments, mapReady]);

  React.useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !mapReady || !map) {
      return;
    }

    recommendedPolylineRef.current?.setMap(null);
    recommendedPolylineRef.current = null;

    if (!recommendedRoute || recommendedRoute.length < 2) {
      return;
    }

    recommendedPolylineRef.current = new google.maps.Polyline({
      map,
      path: recommendedRoute.map(toGoogleLatLng),
      strokeColor: "#2563eb",
      strokeOpacity: 0.86,
      strokeWeight: 5,
      geodesic: true,
    });
  }, [mapReady, recommendedRoute]);

  React.useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    const markerLibrary = markerLibraryRef.current;
    if (!google || !mapReady || !map || !markerLibrary) {
      return;
    }

    clearMarkers(customerMarkersRef.current);
    customerMarkersRef.current = customers
      .map((customer) => {
        const position = resolveCustomerPosition(customer);
        if (!position) {
          return null;
        }

        const content = createCustomerMarkerContent({
          status: customer.visitStatus,
          selected: customer.id === selectedCustomerId,
          suggested: customer.id === suggestedCustomerId,
        });
        // Double-click-to-sell is a native DOM listener since AdvancedMarkerElement
        // content is a real element on the page (no "gmp-dblclick" event exists).
        content.addEventListener("dblclick", () => onCreateSale(customer.id));

        const marker = new markerLibrary.AdvancedMarkerElement({
          map,
          position,
          title: customer.name,
          content,
        });

        // Selecting a market marker opens the compact bottom sheet (see
        // SelectedCustomerCard) instead of a Google InfoWindow popup.
        // AdvancedMarkerElement fires "gmp-click", not the legacy "click".
        marker.addListener("gmp-click", () => {
          setDetachedFromDriver(true);
          onSelectCustomer(customer.id);
        });

        return marker;
      })
      .filter((marker): marker is GoogleMapsAdvancedMarker => Boolean(marker));
  }, [
    customers,
    mapReady,
    onCreateSale,
    onSelectCustomer,
    selectedCustomerId,
    suggestedCustomerId,
  ]);

  React.useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    const markerLibrary = markerLibraryRef.current;
    if (!google || !mapReady || !map || !markerLibrary) {
      return;
    }

    clearMarkers(stopMarkersRef.current);
    stopMarkersRef.current = stops.map((stop, index) => {
      const marker = new markerLibrary.AdvancedMarkerElement({
        map,
        position: toGoogleLatLng(stop),
        title: stop.isActive ? "Arret en cours" : `Arret ${index + 1}`,
        content: createStopMarkerContent({ active: stop.isActive }),
        zIndex: stop.isActive ? 950 : 900,
      });

      marker.addListener("gmp-click", () => {
        infoWindowRef.current?.setContent(buildStopInfoContent(stop, index + 1));
        infoWindowRef.current?.open({ map, anchor: marker });
      });

      return marker;
    });
  }, [mapReady, stops]);

  React.useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    const markerLibrary = markerLibraryRef.current;
    if (!google || !mapReady || !map || !markerLibrary) {
      return;
    }

    // No reliable GPS position: hide the truck marker entirely — never fall
    // back to a default/last-known point here.
    if (!currentPosition) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.map = null;
        driverMarkerRef.current = null;
      }
      accuracyCircleRef.current?.setMap(null);
      accuracyCircleRef.current = null;
      return;
    }

    const position = toGoogleLatLng(currentPosition);

    // Move the same marker instance on every GPS update instead of
    // destroying/recreating it, so the truck glides rather than flickers.
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new markerLibrary.AdvancedMarkerElement({
        map,
        position,
        title: "Position chauffeur",
        content: createTruckMarkerContent(),
        zIndex: 1000,
      });
    } else {
      driverMarkerRef.current.position = position;
    }

    const accuracy =
      currentPosition.accuracy && currentPosition.accuracy > 0
        ? currentPosition.accuracy
        : null;

    if (!accuracy) {
      accuracyCircleRef.current?.setMap(null);
      accuracyCircleRef.current = null;
    } else if (!accuracyCircleRef.current) {
      accuracyCircleRef.current = new google.maps.Circle({
        map,
        center: position,
        radius: accuracy,
        strokeColor: "#059669",
        strokeOpacity: 0.34,
        strokeWeight: 1,
        fillColor: "#10b981",
        fillOpacity: 0.12,
      });
    } else {
      accuracyCircleRef.current.setCenter(position);
      accuracyCircleRef.current.setRadius(accuracy);
    }
  }, [currentPosition, mapReady]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !currentPosition) {
      return;
    }

    const position = toGoogleLatLng(currentPosition);
    if (!hasCenteredOnDriverRef.current) {
      hasCenteredOnDriverRef.current = true;
      map.setCenter(position);
      map.setZoom(Math.max(map.getZoom() ?? 16, 16));
      return;
    }

    if (followDriver && gpsActive) {
      map.panTo(position);
      if ((map.getZoom() ?? 0) < 16) {
        map.setZoom(16);
      }
    }
  }, [currentPosition, followDriver, gpsActive, mapReady]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !selectedCustomerId || followDriver) {
      return;
    }

    if (lastFocusedCustomerIdRef.current === selectedCustomerId) {
      return;
    }

    const selectedCustomer =
      customers.find((customer) => customer.id === selectedCustomerId) ?? null;
    const selectedPosition = resolveCustomerPosition(selectedCustomer);
    if (!selectedPosition) {
      return;
    }

    lastFocusedCustomerIdRef.current = selectedCustomerId;
    map.panTo(selectedPosition);
    map.setZoom(Math.max(map.getZoom() ?? 16, 16));
  }, [customers, followDriver, mapReady, selectedCustomerId]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || recenterTick === 0) {
      return;
    }

    if (currentPosition) {
      map.panTo(toGoogleLatLng(currentPosition));
      map.setZoom(16);
      return;
    }

    const selectedCustomer =
      customers.find((customer) => customer.id === selectedCustomerId) ?? null;
    const selectedPosition = resolveCustomerPosition(selectedCustomer);
    if (selectedPosition) {
      map.panTo(selectedPosition);
      map.setZoom(16);
    }
  }, [currentPosition, customers, mapReady, recenterTick, selectedCustomerId]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {mapError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 px-6 text-center">
          <div className="max-w-sm rounded-3xl border border-border bg-background p-5 shadow-[0_18px_46px_rgba(15,23,42,0.14)]">
            <p className="font-semibold text-foreground">Carte indisponible</p>
            <p className="mt-2 text-sm text-muted-foreground">{mapError}</p>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute right-3 z-[650] sm:right-4",
          // The customer bottom sheet takes more vertical space than the plain
          // action bar, so lift the recenter button clear of it when open.
          selectedCustomerId ? "bottom-[23rem] sm:bottom-[24rem]" : "bottom-40 sm:bottom-44",
        )}
      >
        <div className="pointer-events-auto">
          <RecenterMapButton
            active={followDriver}
            disabled={!currentPosition}
            onClick={() => {
              if (!currentPosition) {
                toast.error("Position GPS indisponible");
                return;
              }
              setDetachedFromDriver(false);
              setRecenterTick((value) => value + 1);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function resolveInitialCustomerPosition(
  customers: DriverTourCustomerDto[],
  selectedCustomerId?: string | null,
  suggestedCustomerId?: string | null,
) {
  const focusedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) ??
    customers.find((customer) => customer.id === suggestedCustomerId) ??
    null;

  return resolveCustomerPosition(focusedCustomer);
}

function resolveCustomerPosition(customer: DriverTourCustomerDto | null) {
  if (
    !customer ||
    customer.latitude === null ||
    customer.latitude === undefined ||
    customer.longitude === null ||
    customer.longitude === undefined
  ) {
    return null;
  }

  return { lat: customer.latitude, lng: customer.longitude };
}

function toGoogleLatLng(point: MapCoordinate) {
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

function clearMarkers(markers: GoogleMapsAdvancedMarker[]) {
  for (const marker of markers) {
    marker.map = null;
  }
}

function buildStopInfoContent(stop: DriverTourStopDto, index: number) {
  const durationSeconds = stop.isActive
    ? Math.max(
        stop.durationSeconds,
        Math.round((Date.now() - new Date(stop.startedAt).getTime()) / 1000),
      )
    : stop.durationSeconds;

  return [
    '<div style="min-width:210px;font-family:system-ui,sans-serif">',
    `<strong style="display:block;color:#0f172a">${
      stop.isActive ? "Arret en cours" : `Arret #${index}`
    }</strong>`,
    `<span style="display:block;margin-top:6px;color:#64748b;font-size:12px">${
      stop.isActive ? "Depuis" : "Arrivee"
    } : ${escapeHtml(formatTimeWithSeconds(stop.startedAt))}</span>`,
    stop.isActive
      ? ""
      : `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">Depart : ${escapeHtml(
          formatTimeWithSeconds(stop.endedAt),
        )}</span>`,
    `<span style="display:block;margin-top:6px;color:#0f172a;font-size:12px">${
      stop.isActive ? "Duree actuelle" : "Duree"
    } : ${escapeHtml(formatStopDuration(durationSeconds))}</span>`,
    "</div>",
  ].join("");
}

function formatStopDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes.toString().padStart(2, "0")} min` : `${hours} h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  }

  return `${seconds} sec`;
}

function formatTimeWithSeconds(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
