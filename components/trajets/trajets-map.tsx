"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { DEFAULT_MAP_CENTER } from "@/lib/gps/gps-config";
import { splitGpsRouteIntoSegments } from "@/lib/gps/gps-utils";
import { formatCurrency } from "@/lib/utils";
import type {
  TruckRouteDto,
  TruckRoutePointDto,
  TruckRouteVisitDto,
} from "@/types/truck-routes";

export function TrajetsMap({ route }: { route: TruckRouteDto }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const googleRef = React.useRef<GoogleMapsApi | null>(null);
  const mapRef = React.useRef<GoogleMapsMap | null>(null);
  const routePolylinesRef = React.useRef<GoogleMapsPolyline[]>([]);
  const markersRef = React.useRef<GoogleMapsMarker[]>([]);
  const infoWindowRef = React.useRef<GoogleMapsInfoWindow | null>(null);
  const initialCenterRef = React.useRef<GoogleMapsLatLngLiteral | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [recenterTick, setRecenterTick] = React.useState(0);

  const visitMarkers = React.useMemo(
    () =>
      route.visits.filter(
        (visit) =>
          visit.latitude !== null &&
          visit.latitude !== undefined &&
          visit.longitude !== null &&
          visit.longitude !== undefined,
      ),
    [route.visits],
  );

  initialCenterRef.current ??= route.points[0]
    ? toGoogleLatLng(route.points[0])
    : resolveVisitPosition(visitMarkers[0]) ?? toLatLng(DEFAULT_MAP_CENTER);

  React.useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(async (google) => {
        await google.maps.importLibrary("maps");

        if (cancelled || !containerRef.current) {
          return;
        }

        googleRef.current = google;
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: initialCenterRef.current,
          zoom: 13,
          disableDefaultUI: true,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
          zoomControlOptions: { position: 6 },
        });
        infoWindowRef.current = new google.maps.InfoWindow();
        setMapReady(true);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setMapError(error.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !mapReady || !map) {
      return;
    }

    clearPolylines(routePolylinesRef.current);
    routePolylinesRef.current = splitGpsRouteIntoSegments(route.points)
      .filter((segment) => segment.length > 1)
      .map(
        (segment) =>
          new google.maps.Polyline({
            map,
            path: segment.map(toGoogleLatLng),
            strokeColor: "#0f7a5d",
            strokeOpacity: 0.88,
            strokeWeight: 5,
            geodesic: true,
          }),
      );
  }, [mapReady, route.points]);

  React.useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !mapReady || !map) {
      return;
    }

    clearMarkers(markersRef.current);
    const markers: GoogleMapsMarker[] = [];
    const startPoint = route.points[0] ?? null;
    const endPoint = route.points.length > 1 ? route.points[route.points.length - 1] ?? null : null;

    if (startPoint) {
      markers.push(
        createPointMarker({
          google,
          map,
          point: startPoint,
          title: "Depart",
          type: "start",
        }),
      );
    }

    if (endPoint) {
      markers.push(
        createPointMarker({
          google,
          map,
          point: endPoint,
          title: "Arrivee",
          type: "end",
        }),
      );
    }

    for (const visit of visitMarkers) {
      const position = resolveVisitPosition(visit);
      if (!position) {
        continue;
      }

      const marker = new google.maps.Marker({
        map,
        position,
        title: visit.customerName,
        icon: buildVisitIcon(google, visit.status),
      });
      marker.addListener("click", () => {
        infoWindowRef.current?.setContent(buildVisitInfoContent(visit));
        infoWindowRef.current?.open({ map, anchor: marker });
      });
      markers.push(marker);
    }

    markersRef.current = markers;
  }, [mapReady, route.points, visitMarkers]);

  React.useEffect(() => {
    if (!mapReady || !googleRef.current || !mapRef.current) {
      return;
    }

    fitRouteBounds(googleRef.current, mapRef.current, route, visitMarkers);
  }, [mapReady, route, visitMarkers, recenterTick]);

  return (
    <div className="relative h-[680px] w-full">
      <div ref={containerRef} className="h-full w-full" />

      {mapError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 px-6 text-center">
          <div className="max-w-sm rounded-3xl border border-border bg-background p-5 shadow-[0_18px_46px_rgba(15,23,42,0.14)]">
            <p className="font-semibold text-foreground">Carte indisponible</p>
            <p className="mt-2 text-sm text-muted-foreground">{mapError}</p>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute right-4 top-4 z-[650]">
        <div className="pointer-events-auto">
          <Button
            type="button"
            variant="outline"
            className="rounded-full bg-background/95 shadow-[0_12px_26px_rgba(15,23,42,0.16)]"
            onClick={() => setRecenterTick((value) => value + 1)}
          >
            Recentrer
          </Button>
        </div>
      </div>
    </div>
  );
}

function createPointMarker({
  google,
  map,
  point,
  title,
  type,
}: {
  google: GoogleMapsApi;
  map: GoogleMapsMap;
  point: TruckRoutePointDto;
  title: string;
  type: "start" | "end";
}) {
  const marker = new google.maps.Marker({
    map,
    position: toGoogleLatLng(point),
    title,
    icon: buildPointIcon(google, type),
  });

  marker.addListener("click", () => {
    const infoWindow = new google.maps.InfoWindow({
      content: buildPointInfoContent(title, point),
    });
    infoWindow.open({ map, anchor: marker });
  });

  return marker;
}

function fitRouteBounds(
  google: GoogleMapsApi,
  map: GoogleMapsMap,
  route: TruckRouteDto,
  visitMarkers: TruckRouteVisitDto[],
) {
  const positions = [
    ...route.points.map(toGoogleLatLng),
    ...visitMarkers
      .map(resolveVisitPosition)
      .filter((position): position is GoogleMapsLatLngLiteral => Boolean(position)),
  ];

  if (positions.length === 0) {
    map.setCenter(toLatLng(DEFAULT_MAP_CENTER));
    map.setZoom(12);
    return;
  }

  if (positions.length === 1) {
    map.setCenter(positions[0]);
    map.setZoom(15);
    return;
  }

  const bounds = new google.maps.LatLngBounds();
  for (const position of positions) {
    bounds.extend(position);
  }
  map.fitBounds(bounds);
}

function toGoogleLatLng(point: { latitude: number; longitude: number }) {
  return { lat: point.latitude, lng: point.longitude };
}

function toLatLng(point: [number, number]) {
  return { lat: point[0], lng: point[1] };
}

function resolveVisitPosition(visit: TruckRouteVisitDto | undefined) {
  if (
    !visit ||
    visit.latitude === null ||
    visit.latitude === undefined ||
    visit.longitude === null ||
    visit.longitude === undefined
  ) {
    return null;
  }

  return { lat: visit.latitude, lng: visit.longitude };
}

function clearPolylines(polylines: GoogleMapsPolyline[]) {
  for (const polyline of polylines) {
    polyline.setMap(null);
  }
}

function clearMarkers(markers: GoogleMapsMarker[]) {
  for (const marker of markers) {
    marker.setMap(null);
  }
}

function buildPointIcon(google: GoogleMapsApi, type: "start" | "end"): GoogleMapsSymbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 8,
    fillColor: type === "start" ? "#10b981" : "#111827",
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 3,
  };
}

function buildVisitIcon(
  google: GoogleMapsApi,
  status: TruckRouteVisitDto["status"],
): GoogleMapsSymbol {
  const color =
    status === "DELIVERED"
      ? "#10b981"
      : status === "NO_SALE"
        ? "#ef4444"
        : status === "ARRIVED"
          ? "#2563eb"
          : "#f59e0b";

  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 8,
    fillColor: color,
    fillOpacity: 0.95,
    strokeColor: "#ffffff",
    strokeWeight: 3,
  };
}

function buildPointInfoContent(title: string, point: TruckRoutePointDto) {
  return [
    '<div style="min-width:180px;font-family:system-ui,sans-serif">',
    `<strong style="display:block;color:#0f172a">${escapeHtml(title)}</strong>`,
    `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">${formatTime(
      point.recordedAt,
    )}</span>`,
    `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">${point.latitude.toFixed(
      5,
    )}, ${point.longitude.toFixed(5)}</span>`,
    "</div>",
  ].join("");
}

function buildVisitInfoContent(visit: TruckRouteVisitDto) {
  return [
    '<div style="min-width:210px;font-family:system-ui,sans-serif">',
    `<strong style="display:block;color:#0f172a">${escapeHtml(visit.customerName)}</strong>`,
    `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">${escapeHtml(
      visit.address || visit.city || "Adresse non renseignee",
    )}</span>`,
    `<span style="display:block;margin-top:6px;color:#0f172a;font-size:12px">${escapeHtml(
      statusLabel(visit.status),
    )} - ${escapeHtml(visit.customerCode)}</span>`,
    `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">Arrivee : ${escapeHtml(
      formatVisitTime(visit.arrivedAt ?? visit.completedAt ?? visit.firstDetectedAt),
    )}</span>`,
    `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">Vente : ${
      visit.saleAmount > 0 ? escapeHtml(formatCurrency(visit.saleAmount)) : "-"
    }</span>`,
    visit.noSaleReason
      ? `<span style="display:block;margin-top:6px;color:#be123c;font-size:12px">${escapeHtml(
          visit.noSaleReason,
        )}</span>`
      : "",
    "</div>",
  ].join("");
}

function statusLabel(status: TruckRouteVisitDto["status"]) {
  switch (status) {
    case "PENDING":
      return "A visiter";
    case "NEARBY":
      return "Client proche";
    case "ARRIVED":
      return "Arrivee confirmee";
    case "DELIVERED":
      return "Livre";
    case "NO_SALE":
      return "Sans vente";
    default:
      return status;
  }
}

function formatVisitTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return formatTime(value);
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
