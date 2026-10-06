"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { DEFAULT_MAP_CENTER } from "@/lib/gps/gps-config";
import { splitGpsRouteIntoSegments } from "@/lib/gps/gps-utils";
import { resolveRouteEndpoints, type RouteEndKind } from "@/lib/truck-routes/route-endpoints";
import {
  formatCommercialStopNumber,
  formatRouteDateTime,
  formatRouteTime,
} from "@/lib/truck-routes/route-format";
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

  // Departure / arrival / last position: the same first and last GPS points the
  // map always used, labelled with the existing tour times (see route-endpoints.ts).
  const endpoints = React.useMemo(() => resolveRouteEndpoints(route), [route]);

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

    if (endpoints.start.point) {
      markers.push(
        createEndpointMarker({
          google,
          map,
          infoWindow: infoWindowRef.current,
          point: endpoints.start.point,
          kind: "START",
          at: endpoints.start.at,
        }),
      );
    }

    if (endpoints.end) {
      markers.push(
        createEndpointMarker({
          google,
          map,
          infoWindow: infoWindowRef.current,
          point: endpoints.end.point,
          kind: endpoints.end.kind,
          at: endpoints.end.at,
        }),
      );
    }

    for (const visit of visitMarkers) {
      const position = resolveVisitPosition(visit);
      if (!position) {
        continue;
      }

      const stopNumber = visit.commercialStopNumber;
      // Commercial stop (a customer with a real sale): a bigger circle in the
      // same status colour, carrying its number, always above the other
      // customers - lower numbers above higher ones. Any other customer keeps
      // its usual circle, a little more discreet.
      const marker = new google.maps.Marker({
        map,
        position,
        title:
          stopNumber !== null
            ? `${formatCommercialStopNumber(stopNumber)} ${visit.customerName}`
            : visit.customerName,
        icon: buildVisitIcon(google, visit.status, stopNumber !== null),
        ...(stopNumber !== null
          ? {
              label: {
                text: String(stopNumber),
                color: "#ffffff",
                fontSize: stopNumber >= 100 ? "10px" : "12px",
                fontWeight: "700",
              },
              zIndex: COMMERCIAL_STOP_Z_INDEX - Math.min(stopNumber, 999),
            }
          : { zIndex: OTHER_CUSTOMER_Z_INDEX }),
      });
      marker.addListener("click", () => {
        infoWindowRef.current?.setContent(buildVisitInfoContent(visit));
        infoWindowRef.current?.open({ map, anchor: marker });
      });
      markers.push(marker);
    }

    markersRef.current = markers;
  }, [mapReady, endpoints, visitMarkers]);

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

// Marker stacking: departure / arrival / last position above everything, then
// the numbered commercial stops, then the other customers.
const ENDPOINT_Z_INDEX = 5000;
const COMMERCIAL_STOP_Z_INDEX = 3000;
const OTHER_CUSTOMER_Z_INDEX = 100;

type EndpointKind = "START" | RouteEndKind;

const ENDPOINT_STYLES: Record<EndpointKind, { label: string; color: string }> = {
  START: { label: "DÉPART", color: "#059669" },
  ARRIVAL: { label: "ARRIVÉE", color: "#dc2626" },
  LAST_POSITION: { label: "DERNIÈRE POSITION", color: "#2563eb" },
};

function createEndpointMarker({
  google,
  map,
  infoWindow,
  point,
  kind,
  at,
}: {
  google: GoogleMapsApi;
  map: GoogleMapsMap;
  infoWindow: GoogleMapsInfoWindow | null;
  point: TruckRoutePointDto;
  kind: EndpointKind;
  at: string | null;
}) {
  const style = ENDPOINT_STYLES[kind];
  const marker = new google.maps.Marker({
    map,
    position: toGoogleLatLng(point),
    title: style.label,
    icon: buildEndpointIcon(google, style.label, style.color),
    zIndex: ENDPOINT_Z_INDEX,
  });

  marker.addListener("click", () => {
    infoWindow?.setContent(buildEndpointInfoContent(kind, at, point));
    infoWindow?.open({ map, anchor: marker });
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

/**
 * A small SVG badge ("DÉPART", "ARRIVÉE", "DERNIÈRE POSITION") with a pointer
 * whose tip sits exactly on the GPS point.
 */
function buildEndpointIcon(google: GoogleMapsApi, label: string, color: string): GoogleMapsIcon {
  const height = 30;
  const tail = 8;
  const width = Math.round(36 + label.length * 8.2);
  const middle = width / 2;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + tail}" viewBox="0 0 ${width} ${height + tail}">`,
    `<path d="M${middle - 7} ${height - 3} L${middle} ${height + tail - 1} L${middle + 7} ${height - 3} Z" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>`,
    `<rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="${(height - 3) / 2}" fill="${color}" stroke="#ffffff" stroke-width="3"/>`,
    `<path d="M${middle - 5.5} ${height - 4.5} L${middle} ${height + tail - 3.5} L${middle + 5.5} ${height - 4.5} Z" fill="${color}"/>`,
    `<circle cx="15" cy="${height / 2}" r="4" fill="#ffffff"/>`,
    `<text x="25" y="${height / 2 + 4.5}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="12" font-weight="700" letter-spacing="0.4" fill="#ffffff">${escapeHtml(label)}</text>`,
    "</svg>",
  ].join("");

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(width, height + tail),
    anchor: new google.maps.Point(middle, height + tail),
  };
}

function buildVisitIcon(
  google: GoogleMapsApi,
  status: TruckRouteVisitDto["status"],
  isCommercialStop: boolean,
): GoogleMapsSymbol {
  const color =
    status === "DELIVERED"
      ? "#10b981"
      : status === "NO_SALE"
        ? "#ef4444"
        : status === "ARRIVED"
          ? "#2563eb"
          : "#f59e0b";

  return isCommercialStop
    ? {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 13,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      }
    : {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: color,
        fillOpacity: 0.85,
        strokeColor: "#ffffff",
        strokeWeight: 2.5,
      };
}

function buildEndpointInfoContent(kind: EndpointKind, at: string | null, point: TruckRoutePointDto) {
  const style = ENDPOINT_STYLES[kind];
  return [
    '<div style="min-width:190px;font-family:system-ui,sans-serif">',
    `<strong style="display:block;color:${style.color};letter-spacing:0.04em">${escapeHtml(style.label)}</strong>`,
    `<span style="display:block;margin-top:4px;color:#0f172a;font-size:13px;font-weight:600">${escapeHtml(
      formatRouteDateTime(at),
    )}</span>`,
    kind === "LAST_POSITION"
      ? '<span style="display:block;margin-top:4px;color:#2563eb;font-size:12px">Tournée en cours</span>'
      : "",
    `<span style="display:block;margin-top:6px;color:#64748b;font-size:12px">Point GPS · ${escapeHtml(
      formatRouteTime(point.recordedAt),
    )}</span>`,
    `<span style="display:block;margin-top:2px;color:#64748b;font-size:12px">${point.latitude.toFixed(
      5,
    )}, ${point.longitude.toFixed(5)}</span>`,
    "</div>",
  ].join("");
}

function buildVisitInfoContent(visit: TruckRouteVisitDto) {
  const stopNumber = visit.commercialStopNumber;
  return [
    '<div style="min-width:210px;font-family:system-ui,sans-serif">',
    `<strong style="display:block;color:#0f172a">${
      stopNumber !== null ? `${escapeHtml(formatCommercialStopNumber(stopNumber))} ` : ""
    }${escapeHtml(visit.customerName)}</strong>`,
    `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">${escapeHtml(
      visit.address || visit.city || "Adresse non renseignee",
    )}</span>`,
    `<span style="display:block;margin-top:6px;color:#0f172a;font-size:12px">${escapeHtml(
      statusLabel(visit.status),
    )} - ${escapeHtml(visit.customerCode)}</span>`,
    stopNumber !== null
      ? [
          `<span style="display:block;margin-top:6px;color:#0f172a;font-size:12px">Première vente · ${escapeHtml(
            formatRouteDateTime(visit.firstSaleAt),
          )}</span>`,
          `<span style="display:block;margin-top:4px;color:#0f172a;font-size:12px">Ventes : ${visit.saleCount}</span>`,
          `<span style="display:block;margin-top:4px;color:#0f172a;font-size:12px">CA : ${escapeHtml(
            formatCurrency(visit.saleAmount),
          )}</span>`,
        ].join("")
      : "",
    `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">Arrivee : ${escapeHtml(
      formatRouteDateTime(visit.arrivedAt ?? visit.completedAt ?? visit.firstDetectedAt),
    )}</span>`,
    stopNumber === null
      ? `<span style="display:block;margin-top:4px;color:#64748b;font-size:12px">Vente : ${
          visit.saleAmount > 0 ? escapeHtml(formatCurrency(visit.saleAmount)) : "-"
        }</span>`
      : "",
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
